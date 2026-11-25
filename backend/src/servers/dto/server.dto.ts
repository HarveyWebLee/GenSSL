import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class CreateServerDto {
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

export class UpdateServerDto {
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
