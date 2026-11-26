import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { SshAuthMethod } from '../../ssh/ssh.types';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

const emptyToNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
};

const toBoolean = ({ value }: { value: unknown }) => value === true || value === 'true';

export const SSH_AUTH_METHODS = ['password', 'privateKey'] as const;

export class SshCredentialFieldsDto {
  @Transform(emptyToNumber)
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'SSH 端口必须是整数' })
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  sshUsername?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(SSH_AUTH_METHODS, { message: '认证方式只能是密码或私钥' })
  sshAuthMethod?: SshAuthMethod;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sshPassword?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  sshPrivateKey?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sshPassphrase?: string;

  @Transform(emptyToNumber)
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '连接超时必须是整数' })
  @Min(1000, { message: '连接超时至少为 1000 毫秒' })
  @Max(120000, { message: '连接超时不能超过 120000 毫秒' })
  sshTimeoutMs?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  clearSshCredentials?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  clearSshPassword?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  clearSshPrivateKey?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  clearSshPassphrase?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  resetSshHostKey?: boolean;
}

export class CreateServerDto extends SshCredentialFieldsDto {
  @IsString()
  @MinLength(1, { message: '服务器名称不能为空' })
  @MaxLength(128)
  name!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateServerDto extends SshCredentialFieldsDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateServerPathDto {
  @IsString()
  @MinLength(1, { message: '部署路径不能为空' })
  @MaxLength(512)
  path!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;
}

export class UpdateServerPathDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  path?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;
}

export class TestServerConnectionDto extends SshCredentialFieldsDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4')
  serverId?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4')
  pathId?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  remotePath?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  trustHostKey?: boolean;
}
