import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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

  @OneToMany(() => ServerPathEntity, (path) => path.server, { cascade: true })
  paths!: ServerPathEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
