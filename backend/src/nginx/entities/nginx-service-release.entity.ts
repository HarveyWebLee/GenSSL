import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NginxServiceEntity } from './nginx-service.entity';

export type NginxReleaseStatus = 'success' | 'failed' | 'partial';

@Entity('nginx_service_releases')
@Index('UQ_nginx_releases_version_active', ['serviceId', 'version'], {
  unique: true,
  where: '"deletedAt" IS NULL AND "sourceReleaseId" IS NULL',
})
export class NginxServiceReleaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => NginxServiceEntity, (service) => service.releases, { onDelete: 'RESTRICT' })
  service!: NginxServiceEntity;

  @Column()
  serviceId!: string;

  @Column({ length: 64 })
  version!: string;

  @Column({ type: 'text' })
  remark!: string;

  /** 本次发布使用的配置快照。发布成功后作为历史档案保留；重新发布会再生成新记录。 */
  @Column({ type: 'text' })
  configText!: string;

  /** 发布时写入的远程路径，便于对照之后变更的服务配置。 */
  @Column({ length: 512 })
  configPath!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  archiveObjectKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archiveUploadedAt!: Date | null;

  /** 若为重新发布，指向被重放的历史版本。 */
  @Column({ type: 'uuid', nullable: true })
  sourceReleaseId!: string | null;

  @Column({ length: 16, default: 'success' })
  status!: NginxReleaseStatus;

  @Column({ type: 'timestamptz' })
  publishedAt!: Date;

  @Column({ default: false })
  written!: boolean;

  /** 仅作历史记录，实际执行时始终使用服务上当前配置的重启命令。 */
  @Column({ length: 500 })
  restartCommandUsed!: string;

  @Column({ default: false })
  restartExecuted!: boolean;

  @Column({ type: 'int', nullable: true })
  restartExitCode!: number | null;

  @Column({ type: 'text', nullable: true })
  restartStdout!: string | null;

  @Column({ type: 'text', nullable: true })
  restartStderr!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remoteHost!: string | null;

  @Column({ type: 'int', nullable: true })
  remotePort!: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  remoteUsername!: string | null;

  @Column({ default: false })
  rustfsSynced!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
