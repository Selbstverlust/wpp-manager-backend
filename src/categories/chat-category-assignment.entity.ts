import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Category } from './category.entity';

@Entity({ name: 'chat_category_assignments' })
@Unique('UQ_chat_category_assignment', ['categoryId', 'remoteJid', 'instanceName'])
@Index('IDX_chat_category_user', ['userId'])
export class ChatCategoryAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'category_id' })
  categoryId: string;

  @ManyToOne(() => Category, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @Column({ name: 'remote_jid' })
  remoteJid: string;

  @Column({ name: 'instance_name' })
  instanceName: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
