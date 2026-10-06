import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp, setupSwagger } from './app.module.js';

const app = configureApp(
  await NestFactory.create(
    AppModule.forRoot({
      databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ledger',
      apiKey: process.env.API_KEY || undefined,
    }),
  ),
);
setupSwagger(app);
await app.listen(Number(process.env.PORT ?? 3000));
console.log(`ledger-nest listening on ${await app.getUrl()} — OpenAPI docs at /docs`);
