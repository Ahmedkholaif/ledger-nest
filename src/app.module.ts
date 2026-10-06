import { Controller, DynamicModule, Get, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HealthCheck, HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiKeyGuard, API_KEY, Public } from './common/api-key.guard.js';
import { ErrorFilter } from './common/error.filter.js';
import { DatabaseModule } from './database/database.module.js';
import { DatabaseService } from './database/database.service.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { LedgerError } from './ledger/ledger.errors.js';

export interface AppOptions {
  databaseUrl: string;
  apiKey?: string;
}

@Controller('healthz')
class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([async () => (await this.db.query('SELECT 1'), { database: { status: 'up' as const } })]);
  }
}

@Module({})
export class AppModule {
  static forRoot(opts: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot({ url: opts.databaseUrl }), LedgerModule, TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: API_KEY, useValue: opts.apiKey },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}

/** Global HTTP setup shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const msgs = errors.flatMap(function collect(e): string[] {
          return [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap(collect)];
        });
        return LedgerError.invalid(msgs.join('; ') || 'validation failed');
      },
    }),
  );
  app.enableShutdownHooks();
  return app;
}

export function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('ledger-nest')
    .setDescription('Double-entry ledger API: the same contract as ledgerd (Go). Amounts are integer minor units.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc));
}
