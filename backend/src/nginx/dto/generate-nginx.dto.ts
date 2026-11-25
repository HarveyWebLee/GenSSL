import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GenerateNginxDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  serverName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  listenPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  rootPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  proxyPass?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  sslCertificate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  sslCertificateKey?: string;
}
