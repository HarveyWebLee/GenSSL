import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class DownloadCertQueryDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(['bundle', 'cert', 'key'], { message: '下载类型仅支持 bundle、cert 或 key' })
  part?: 'bundle' | 'cert' | 'key';

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(8)
  format?: string;
}
