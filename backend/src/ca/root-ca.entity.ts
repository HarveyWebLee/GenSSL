import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';

export type RootCaLifecycleStatus = 'active' | 'retired';

@Entity('root_cas')
export class RootCaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 128 })
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

  @OneToMany(() => IssuedCertificateEntity, (cert) => cert.ca)
  certificates!: IssuedCertificateEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
