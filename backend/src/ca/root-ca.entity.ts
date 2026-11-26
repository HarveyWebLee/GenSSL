import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';

export type RootCaLifecycleStatus = 'active' | 'retired';

@Entity('root_cas')
@Index('UQ_root_cas_name_active', ['name'], { unique: true, where: '"deletedAt" IS NULL' })
export class RootCaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 128 })
  name!: string;

  @Column({ length: 128 })
  commonName!: string;

  @Column({ type: 'jsonb', default: {} })
  subject!: Record<string, string>;

  @Column({ type: 'jsonb', default: {} })
  issuer!: Record<string, string>;

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

  @Column({ length: 32, default: 'RSA' })
  publicKeyAlgorithm!: string;

  @Column({ type: 'int', default: 4096 })
  publicKeyBits!: number;

  @Column({ type: 'jsonb', default: [] })
  keyUsage!: string[];

  @Column({ type: 'int', nullable: true })
  pathLenConstraint!: number | null;

  @Column({ length: 200 })
  publicFileName!: string;

  @Column({ length: 16, default: 'active' })
  status!: RootCaLifecycleStatus;

  @Column({ type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;

  /** 同一棵根被重新生成并覆盖后递增，用来判断下属证书是否仍由当前私钥签发。 */
  @Column({ type: 'int', default: 1 })
  generation!: number;

  @Column({ type: 'timestamptz', nullable: true })
  regeneratedAt!: Date | null;

  /** 根 CA 私钥，仅存数据库，select: false，永不进入 API 或 RustFS。 */
  @Column({ type: 'text', select: false })
  privateKeyPem!: string;

  /** 根证书公钥 PEM，用于签发与校验；同时作为档案上传到证书库。 */
  @Column({ type: 'text' })
  certificatePem!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  archiveObjectKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archiveUploadedAt!: Date | null;

  /** 软删除时间；有值表示已从管理界面隐藏，私钥与证书库档案仍保留。 */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => IssuedCertificateEntity, (cert) => cert.ca)
  certificates!: IssuedCertificateEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
