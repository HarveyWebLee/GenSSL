import { Transform, Type } from 'class-transformer';
import { MAX_CERT_VALIDITY_DAYS } from '../../cert-validity';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class IssueCertDto {
  @IsUUID('4', { message: '请选择用于签发的根证书' })
  caId!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsArray()
  @ArrayMinSize(1, { message: '至少需要填写一个服务器 IP 地址' })
  @IsString({ each: true })
  ips!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dnsNames?: string[];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  stateOrProvince?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  locality?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organization?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationalUnit?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  commonName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: '有效期至少为 1 天' })
  @Max(MAX_CERT_VALIDITY_DAYS, { message: '有效期最长为 50 年（18250 天）' })
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([2048, 4096], { message: '服务器证书密钥长度仅支持 2048 或 4096，默认 2048' })
  keySize?: 2048 | 4096;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(['sha256', 'sha384', 'sha512'])
  hashAlgorithm?: 'sha256' | 'sha384' | 'sha512';

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  publicFileName?: string;
}
