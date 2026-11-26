import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CONFIG_TEXT_MAX = 262144;

export class CreateNginxServiceDto {
  @IsUUID('4', { message: '请选择已登记的服务器。' })
  serverId!: string;

  @IsString()
  @MaxLength(128, { message: '服务名称请控制在 128 个字符以内。' })
  name!: string;

  @Type(() => Number)
  @IsInt({ message: '端口必须是 1 到 65535 之间的整数。' })
  @Min(1, { message: '端口必须是 1 到 65535 之间的整数。' })
  @Max(65535, { message: '端口必须是 1 到 65535 之间的整数。' })
  port!: number;

  @IsString()
  @MaxLength(512, { message: 'Nginx 配置文件路径过长。' })
  configPath!: string;

  @IsString()
  @MaxLength(CONFIG_TEXT_MAX, { message: '配置文件内容过长，请控制在 256 KB 以内。' })
  configText!: string;

  @IsString()
  @MaxLength(500, { message: '重启服务命令过长，请控制在 500 个字符以内。' })
  restartCommand!: string;
}

export class UpdateNginxServiceDto {
  @IsOptional()
  @IsUUID('4', { message: '请选择已登记的服务器。' })
  serverId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '服务名称请控制在 128 个字符以内。' })
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '端口必须是 1 到 65535 之间的整数。' })
  @Min(1, { message: '端口必须是 1 到 65535 之间的整数。' })
  @Max(65535, { message: '端口必须是 1 到 65535 之间的整数。' })
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512, { message: 'Nginx 配置文件路径过长。' })
  configPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONFIG_TEXT_MAX, { message: '配置文件内容过长，请控制在 256 KB 以内。' })
  configText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '重启服务命令过长，请控制在 500 个字符以内。' })
  restartCommand?: string;
}

export class PublishNginxServiceDto {
  @IsString()
  @MaxLength(64, { message: '版本号请控制在 64 个字符以内。' })
  version!: string;

  @IsString()
  @MaxLength(500, { message: '备注请控制在 500 个字符以内。' })
  remark!: string;

  @IsOptional()
  @IsBoolean()
  trustHostKey?: boolean;
}

export class UpdateNginxReleaseDto {
  @IsString()
  @MaxLength(500, { message: '备注请控制在 500 个字符以内。' })
  remark!: string;
}

export class RestartNginxServiceDto {
  @IsOptional()
  @IsBoolean()
  trustHostKey?: boolean;
}

export class RepublishNginxReleaseDto {
  @IsOptional()
  @IsBoolean()
  trustHostKey?: boolean;
}
