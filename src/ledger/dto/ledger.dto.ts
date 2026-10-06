import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';

export const MAX_POSTINGS = 64;

// Request validation lives on the DTOs. The same decorators drive the global
// ValidationPipe and the generated OpenAPI document at /docs.

export class CreateAccountDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 code' })
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code such as USD' })
  currency: string;

  @ApiPropertyOptional({ default: false, description: 'Allow the balance to go below zero (e.g. funding or clearing accounts)' })
  @IsOptional()
  @IsBoolean()
  allow_negative?: boolean;
}

export class PostingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  account_id: string;

  @ApiProperty({ example: -2500, description: 'Minor units. Negative debits the account, positive credits it.' })
  @IsInt()
  @NotEquals(0, { message: 'posting amounts must be non-zero' })
  @Min(Number.MIN_SAFE_INTEGER)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;
}

export class CreateTransferDto {
  @ApiPropertyOptional({ example: 'order #8812' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ type: [PostingDto], minItems: 2, maxItems: MAX_POSTINGS })
  @ValidateNested({ each: true })
  @Type(() => PostingDto)
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_POSTINGS)
  postings: PostingDto[];
}

export class AccountDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() currency: string;
  @ApiProperty() allow_negative: boolean;
  @ApiProperty({ description: 'Minor units' }) balance: number;
  @ApiProperty() created_at: Date;
}

export class AccountListDto {
  @ApiProperty({ type: [AccountDto] }) accounts: AccountDto[];
}

export class EntryDto {
  @ApiProperty() id: number;
  @ApiProperty() transfer_id: string;
  @ApiProperty() account_id: string;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() balance_after: number;
  @ApiProperty() created_at: Date;
}

export class TransferDto {
  @ApiProperty() id: string;
  @ApiProperty() idempotency_key: string;
  @ApiProperty() description: string;
  @ApiProperty() created_at: Date;
  @ApiProperty({ type: [EntryDto] }) entries: EntryDto[];
}

export class EntryPageDto {
  @ApiProperty({ type: [EntryDto] }) entries: EntryDto[];
  @ApiProperty({ nullable: true, type: Number, description: 'Pass as ?after= to fetch the next page' }) next_after: number | null;
}

export class MismatchDto {
  @ApiProperty({ enum: ['account', 'currency'] }) kind: string;
  @ApiProperty() id: string;
  @ApiProperty() expected: number;
  @ApiProperty() actual: number;
}

export class AuditDto {
  @ApiProperty() consistent: boolean;
  @ApiProperty({ type: [MismatchDto] }) mismatches: MismatchDto[];
}
