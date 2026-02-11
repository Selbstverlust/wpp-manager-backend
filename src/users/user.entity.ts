import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ select: false, nullable: true })
  password: string;

  @Column({ default: 'user' })
  role: string;

  @Index()
  @Column({ name: 'parent_user_id', type: 'uuid', nullable: true })
  parentUserId: string | null;

  @ManyToOne(() => User, (user) => user.subUsers, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_user_id' })
  parentUser: User;

  @OneToMany(() => User, (user) => user.parentUser)
  subUsers: User[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}


