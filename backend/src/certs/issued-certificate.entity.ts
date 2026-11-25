import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('issued_certificates')
export class IssuedCertificateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 128 })
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

  @Column({ length: 64 })
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
