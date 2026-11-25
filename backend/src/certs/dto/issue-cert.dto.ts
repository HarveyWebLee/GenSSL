import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class IssueCertDto {
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
  @Max(825, { message: '有效期最长为 825 天' })
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

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overwrite?: boolean;
}
