import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { SubscriptionTier } from '../subscriptions/subscription.entity';

export enum PaymentStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
}

@Entity({ name: 'payments' })
export class Payment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Index()
    @Column({ name: 'paypal_subscription_id', nullable: true })
    paypalSubscriptionId: string | null;

    @Column({ name: 'paypal_payer_id', nullable: true })
    paypalPayerId: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    amount: number;

    @Column({ length: 3, default: 'BRL' })
    currency: string;

    @Column({
        type: 'varchar',
        default: PaymentStatus.PENDING,
    })
    status: PaymentStatus;

    @Column({
        name: 'subscription_tier',
        type: 'varchar',
        default: SubscriptionTier.PRO,
    })
    subscriptionTier: SubscriptionTier;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
    completedAt: Date | null;
}
