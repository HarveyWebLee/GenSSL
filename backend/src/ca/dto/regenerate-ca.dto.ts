import { Transform, Type } from 'class-transformer';
import { MAX_CERT_VALIDITY_DAYS } from '../../cert-validity';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { CA_HASH_ALGORITHMS, CA_KEY_SIZES, type CaHashAlgorithm, type CaKeySize } from './create-ca.dto';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class RegenerateCaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '密钥长度必须是整数' })
  @IsIn(CA_KEY_SIZES, { message: '密钥长度仅支持 2048、4096 或 8192' })
  keySize?: CaKeySize;

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

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(CA_HASH_ALGORITHMS, { message: '签名算法仅支持 sha256、sha384 或 sha512' })
  hashAlgorithm?: CaHashAlgorithm;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '路径长度约束必须是整数' })
  @Min(0, { message: '路径长度约束必须是大于或等于 0 的整数' })
  pathLenConstraint?: number;
}
