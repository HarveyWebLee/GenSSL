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

export interface DeployedFile {
  kind: DeployedFileKind;
  fileName: string;
  objectKey: string;
  size: number;
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
