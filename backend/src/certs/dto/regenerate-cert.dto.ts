import { Transform, Type } from 'class-transformer';
import { MAX_CERT_VALIDITY_DAYS } from '../../cert-validity';
import { ArrayUnique, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class RegenerateCertDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '有效期必须是整数天数' })
  @Min(1, { message: '有效期至少为 1 天' })
  @Max(MAX_CERT_VALIDITY_DAYS, { message: '有效期最长为 50 年（18250 天）' })
  days?: number;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsISO8601({}, { message: '生效时间必须是有效的 ISO 8601 日期时间' })
  notBefore?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '密钥长度必须是整数' })
  @IsIn([2048, 4096], { message: '服务器证书密钥长度仅支持 2048 或 4096' })
  keySize?: 2048 | 4096;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(['sha256', 'sha384', 'sha512'])
  hashAlgorithm?: 'sha256' | 'sha384' | 'sha512';
}

export class RegenerateCertsBatchDto extends RegenerateCertDto {
  @IsOptional()
  @IsArray({ message: '证书 ID 列表必须是数组' })
  @ArrayUnique({ message: '证书 ID 不能重复' })
  @IsUUID('4', { each: true, message: '证书 ID 必须是 UUID' })
  ids?: string[];

  @IsOptional()
  @IsUUID('4', { message: '根证书 ID 必须是 UUID' })
  caId?: string;
}
