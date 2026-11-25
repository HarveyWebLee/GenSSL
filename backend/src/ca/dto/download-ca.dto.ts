import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CA_CERT_FORMATS, type CaCertFormat } from '../ca-filename';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class DownloadCaQueryDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: '公共文件名必须是字符串' })
  @MaxLength(200, { message: '公共文件名长度不能超过 200 个字符' })
  filename?: string;

  @Transform(({ value }) =>
    value === '' || value === null ? undefined : typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsIn(CA_CERT_FORMATS, { message: '下载格式仅支持 crt、cer 或 pem' })
  format?: CaCertFormat;
}
