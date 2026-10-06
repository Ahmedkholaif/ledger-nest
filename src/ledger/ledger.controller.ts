import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseInterceptors, DefaultValuePipe } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { IdempotencyKey, IdempotentReplayInterceptor } from '../common/idempotency.js';
import { AccountDto, AccountListDto, AuditDto, CreateAccountDto, CreateTransferDto, EntryPageDto, TransferDto } from './dto/ledger.dto.js';
import { LedgerService } from './ledger.service.js';

@ApiTags('accounts')
@Controller('v1/accounts')
export class AccountsController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  @ApiOperation({ summary: 'Open an account' })
  @ApiCreatedResponse({ type: AccountDto })
  create(@Body() dto: CreateAccountDto) {
    return this.ledger.createAccount(dto);
  }

  @Get()
  @ApiOperation({ summary: 'All accounts in creation order' })
  @ApiOkResponse({ type: AccountListDto })
  async list(@Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number): Promise<AccountListDto> {
    return { accounts: await this.ledger.listAccounts(limit) };
  }

  @Get(':id')
  @ApiOkResponse({ type: AccountDto })
  get(@Param('id') id: string) {
    return this.ledger.getAccount(id);
  }

  @Get(':id/entries')
  @ApiOperation({ summary: "An account's journal, paginated by entry id (keyset pagination)" })
  @ApiOkResponse({ type: EntryPageDto })
  async entries(
    @Param('id') id: string,
    @Query('after', new DefaultValuePipe(0), ParseIntPipe) after: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<EntryPageDto> {
    const entries = await this.ledger.listEntries(id, after, limit);
    return { entries, next_after: entries.at(-1)?.id ?? null };
  }
}

@ApiTags('transfers')
@Controller('v1/transfers')
export class TransfersController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  @UseInterceptors(IdempotentReplayInterceptor)
  @ApiOperation({ summary: 'Move money between accounts (atomic, balanced, idempotent)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Retries with the same key and body replay the original result' })
  @ApiCreatedResponse({ type: TransferDto, description: 'Transfer applied' })
  @ApiOkResponse({ type: TransferDto, description: 'Replay of an earlier request (header Idempotent-Replayed: true)' })
  @ApiConflictResponse({ description: 'insufficient_funds or idempotency_conflict' })
  @ApiUnprocessableEntityResponse({ description: 'invalid_request' })
  async create(@IdempotencyKey() key: string | undefined, @Body() dto: CreateTransferDto) {
    const { transfer, replayed } = await this.ledger.transfer(key, dto);
    return { result: transfer, replayed };
  }

  @Get(':id')
  @ApiOkResponse({ type: TransferDto })
  get(@Param('id') id: string) {
    return this.ledger.getTransfer(id);
  }
}

@ApiTags('audit')
@Controller('v1/audit')
export class AuditController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recompute every balance from the journal and check each currency nets to zero' })
  @ApiOkResponse({ type: AuditDto })
  audit() {
    return this.ledger.audit();
  }
}
