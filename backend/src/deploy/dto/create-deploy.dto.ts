import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateDeployDto {
  @IsUUID('4', { message: '请选择要部署的证书' })
  certificateId!: string;

  @IsUUID('4', { message: '请选择目标服务器' })
  serverId!: string;

  @IsUUID('4', { message: '请选择目标部署路径' })
  pathId!: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRootCaCert?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overwrite?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  trustHostKey?: boolean;
}
