import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServerEntity } from './server.entity';

@Entity('server_paths')
@Index(['serverId', 'path'], { unique: true })
export class ServerPathEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ServerEntity, (server) => server.paths, { onDelete: 'CASCADE' })
  server!: ServerEntity;

  @Column()
  serverId!: string;

  @Column({ length: 512 })
  path!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  label!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
