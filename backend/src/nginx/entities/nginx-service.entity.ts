import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServerEntity } from '../../servers/entities/server.entity';
import { NginxServiceReleaseEntity } from './nginx-service-release.entity';

@Entity('nginx_services')
@Index('UQ_nginx_services_server_name_active', ['serverId', 'name'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('UQ_nginx_services_server_port_active', ['serverId', 'port'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('UQ_nginx_services_server_path_active', ['serverId', 'configPath'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class NginxServiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ServerEntity, { onDelete: 'RESTRICT' })
  server!: ServerEntity;

  @Column()
  serverId!: string;

  @Column({ length: 128 })
  name!: string;

  @Column({ type: 'int' })
  port!: number;

  /** 远程 Nginx 配置文件的绝对路径，例如 /data/smartsecurity/nginx/vhost/avatar.conf。 */
  @Column({ length: 512 })
  configPath!: string;

  /** 当前工作副本中的配置文本；发布时再生成不可变快照。 */
  @Column({ type: 'text' })
  configText!: string;

  /** 重启命令保存在服务上，发布、手动重启和重新发布都使用当前这条命令。 */
  @Column({ length: 500 })
  restartCommand!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  archiveObjectKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archiveUploadedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  currentReleaseId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => NginxServiceReleaseEntity, (release) => release.service)
  releases!: NginxServiceReleaseEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
