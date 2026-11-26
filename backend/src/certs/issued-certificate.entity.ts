import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RootCaEntity } from '../ca/root-ca.entity';

@Entity('issued_certificates')
@Index('UQ_issued_certificates_ca_name_active', ['caId', 'name'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class IssuedCertificateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => RootCaEntity, (ca) => ca.certificates, { onDelete: 'RESTRICT' })
  ca!: RootCaEntity;

  @Column()
  caId!: string;

  @Column({ length: 128 })
  name!: string;

  @Column({ length: 128 })
  commonName!: string;

  @Column({ type: 'jsonb' })
  ips!: string[];

  @Column({ type: 'jsonb', default: [] })
  dnsNames!: string[];

  @Column({ type: 'int' })
  days!: number;

  @Column({ type: 'timestamptz' })
  notBefore!: Date;

  @Column({ type: 'timestamptz' })
  notAfter!: Date;

  @Column({ length: 64, unique: true })
  serialNumber!: string;

  @Column({ length: 128 })
  fingerprintSha256!: string;

  @Column({ length: 64, default: 'sha256WithRSAEncryption' })
  signatureAlgorithm!: string;

  @Column({ type: 'int', default: 2048 })
  publicKeyBits!: number;

  @Column({ type: 'jsonb', default: {} })
  subject!: Record<string, string>;

  @Column({ length: 200 })
  publicFileName!: string;

  @Column({ length: 200 })
  keyFileName!: string;

  @Column({ type: 'text' })
  sanDisplay!: string;

  /** 签发时所属根的 generation；根被覆盖后会小于当前根的 generation。 */
  @Column({ type: 'int', default: 1 })
  caGeneration!: number;

  /** 签发时根证书的 SHA-256 指纹，用于判断是否仍由当前根私钥签发。 */
  @Column({ length: 128, default: '' })
  issuerFingerprintSha256!: string;

  /** 服务器证书公钥 PEM，作为元数据保存在数据库；私钥只在证书库中。 */
  @Column({ type: 'text' })
  certificatePem!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  archiveObjectPrefix!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  archiveCertObjectKey!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  archiveKeyObjectKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archiveUploadedAt!: Date | null;

  /** 软删除时间；有值表示已从管理界面隐藏，证书库档案仍保留。 */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
