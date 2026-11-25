import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export const CA_KEY_SIZES = [2048, 4096, 8192] as const;
export const CA_HASH_ALGORITHMS = ['sha256', 'sha384', 'sha512'] as const;

export type CaKeySize = (typeof CA_KEY_SIZES)[number];
export type CaHashAlgorithm = (typeof CA_HASH_ALGORITHMS)[number];

export class CreateCaDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '国家代码必须是字符串' })
  @Matches(/^[A-Za-z]{2}$/, { message: '国家代码必须是 2 位字母（ISO 3166-1）' })
  country?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '省/州必须是字符串' })
  @MaxLength(128, { message: '省/州长度不能超过 128 个字符' })
  stateOrProvince?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '城市必须是字符串' })
  @MaxLength(128, { message: '城市长度不能超过 128 个字符' })
  locality?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '组织必须是字符串' })
  @MaxLength(64, { message: '组织长度不能超过 64 个字符' })
  organization?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '组织单位必须是字符串' })
  @MaxLength(64, { message: '组织单位长度不能超过 64 个字符' })
  organizationalUnit?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '通用名称必须是字符串' })
  @MaxLength(128, { message: '通用名称长度不能超过 128 个字符' })
  commonName?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail({}, { message: '邮箱地址格式不正确' })
  @MaxLength(128, { message: '邮箱地址长度不能超过 128 个字符' })
  emailAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '密钥长度必须是整数' })
  @IsIn(CA_KEY_SIZES, { message: '密钥长度仅支持 2048、4096 或 8192' })
  keySize?: CaKeySize;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '有效期必须是整数天数' })
  @Min(1, { message: '有效期至少为 1 天' })
  @Max(3650, { message: '有效期最长为 3650 天' })
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

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '公共文件名必须是字符串' })
  @MaxLength(200, { message: '公共文件名长度不能超过 200 个字符' })
  publicFileName?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean({ message: 'overwrite 必须是布尔值' })
  overwrite?: boolean;
}
