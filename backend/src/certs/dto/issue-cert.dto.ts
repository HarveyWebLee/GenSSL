import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class IssueCertDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ips!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dnsNames?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationalUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  commonName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(825)
  days?: number;

  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}
