import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity({ name: 'stripe_events' })
export class StripeEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ name: 'stripe_event_id' })
    stripeEventId: string;

    @Column({ name: 'event_type' })
    eventType: string;

    @CreateDateColumn({ name: 'processed_at' })
    processedAt: Date;
}
