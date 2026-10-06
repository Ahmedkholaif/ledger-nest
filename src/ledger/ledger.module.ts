import { Module } from '@nestjs/common';
import { AccountsController, AuditController, TransfersController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';

@Module({
  controllers: [AccountsController, TransfersController, AuditController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
