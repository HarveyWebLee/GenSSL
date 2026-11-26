import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SshAuthMethod } from '../../ssh/ssh.types';
import { DEFAULT_SSH_PORT, DEFAULT_SSH_TIMEOUT_MS } from '../../ssh/ssh.types';
import { ServerPathEntity } from './server-path.entity';

@Entity('servers')
export class ServerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  host!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', default: DEFAULT_SSH_PORT })
  sshPort!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  sshUsername!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'password' })
  sshAuthMethod!: SshAuthMethod;

  /** 加密后的 SSH 密码，仅存数据库，select: false，永不进入 API。 */
  @Column({ type: 'text', nullable: true, select: false })
  sshPasswordCipher!: string | null;

  /** 加密后的 SSH 私钥，仅存数据库，select: false，永不进入 API。 */
  @Column({ type: 'text', nullable: true, select: false })
  sshPrivateKeyCipher!: string | null;

  /** 加密后的私钥口令，仅存数据库，select: false，永不进入 API。 */
  @Column({ type: 'text', nullable: true, select: false })
  sshPassphraseCipher!: string | null;

  @Column({ default: false })
  hasSshPassword!: boolean;

  @Column({ default: false })
  hasSshPrivateKey!: boolean;

  @Column({ default: false })
  hasSshPassphrase!: boolean;

  @Column({ type: 'int', default: DEFAULT_SSH_TIMEOUT_MS })
  sshTimeoutMs!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sshHostKeyAlgorithm!: string | null;

  /** 已锁定的远程主机公钥（原始 base64），仅用于校验，不对外返回。 */
  @Column({ type: 'text', nullable: true, select: false })
  sshHostKey!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  sshHostKeyFingerprint!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sshHostKeyPinnedAt!: Date | null;

  @OneToMany(() => ServerPathEntity, (path) => path.server, { cascade: true })
  paths!: ServerPathEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
