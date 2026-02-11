import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../users/user.entity';
import { Instance } from '../instances/instance.entity';

@Entity({ name: 'sub_user_permissions' })
@Index('IDX_sub_user_permissions_unique', ['subUserId', 'instanceId'], { unique: true })
export class SubUserPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'sub_user_id', type: 'uuid' })
  subUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sub_user_id' })
  subUser: User;

  @Index()
  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @ManyToOne(() => Instance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instance_id' })
  instance: Instance;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
