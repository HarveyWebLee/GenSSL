import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { ServerEntity } from '../servers/entities/server.entity';
import { ServerPathEntity } from '../servers/entities/server-path.entity';

export type DeployedFileKind = 'server-cert' | 'server-key' | 'ca-cert';
export type DeployRecordStatus = 'success' | 'failed';

export interface DeployedFile {
  kind: DeployedFileKind;
  fileName: string;
  objectKey: string;
  size: number;
  remotePath?: string;
}

@Entity('deploy_records')
export class DeployRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => IssuedCertificateEntity, { onDelete: 'CASCADE' })
  certificate!: IssuedCertificateEntity;

  @Column()
  certificateId!: string;

  @ManyToOne(() => ServerEntity, { onDelete: 'CASCADE' })
  server!: ServerEntity;

  @Column()
  serverId!: string;

  @ManyToOne(() => ServerPathEntity, { onDelete: 'CASCADE' })
  path!: ServerPathEntity;

  @Column()
  pathId!: string;

  @Column({ length: 512 })
  objectPrefix!: string;

  @Column({ type: 'jsonb' })
  files!: DeployedFile[];

  @Column({ default: false })
  overwritten!: boolean;

  /** 上传时服务器证书的 SHA-256 指纹，用于判断部署目录中的文件是否已过时。 */
  @Column({ length: 128, default: '' })
  certificateFingerprintSha256!: string;

  @Column({ length: 16, default: 'success' })
  status!: DeployRecordStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remoteHost!: string | null;

  @Column({ type: 'int', nullable: true })
  remotePort!: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  remoteUsername!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  remotePath!: string | null;

  @Column({ default: false })
  rustfsSynced!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
