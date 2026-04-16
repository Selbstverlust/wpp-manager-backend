import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddStripeSupport1744000000000 implements MigrationInterface {
    name = 'AddStripeSupport1744000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- payments table: add Stripe columns ---
        const paymentsColumns = [
            { name: 'stripe_customer_id', type: 'varchar', isNullable: true },
            { name: 'stripe_subscription_id', type: 'varchar', isNullable: true },
            { name: 'stripe_session_id', type: 'varchar', isNullable: true },
            { name: 'stripe_event_id', type: 'varchar', isNullable: true },
            { name: 'payment_provider', type: 'varchar', isNullable: true, default: "'paypal'" },
        ];

        for (const col of paymentsColumns) {
            const exists = await queryRunner.hasColumn('payments', col.name);
            if (!exists) {
                await queryRunner.addColumn('payments', {
                    name: col.name,
                    type: col.type,
                    isNullable: col.isNullable,
                    default: col.default,
                } as any);
            }
        }

        // Index on stripe_event_id
        try {
            await queryRunner.createIndex(
                'payments',
                new TableIndex({
                    name: 'IDX_PAYMENTS_STRIPE_EVENT_ID',
                    columnNames: ['stripe_event_id'],
                }),
            );
        } catch {
            // index may already exist
        }

        // --- subscriptions table: add Stripe columns ---
        const subscriptionsColumns = [
            { name: 'stripe_customer_id', type: 'varchar', isNullable: true },
            { name: 'stripe_subscription_id', type: 'varchar', isNullable: true },
            { name: 'payment_provider', type: 'varchar', isNullable: true },
        ];

        for (const col of subscriptionsColumns) {
            const exists = await queryRunner.hasColumn('subscriptions', col.name);
            if (!exists) {
                await queryRunner.addColumn('subscriptions', {
                    name: col.name,
                    type: col.type,
                    isNullable: col.isNullable,
                } as any);
            }
        }

        // --- stripe_events table ---
        const stripeEventsExists = await queryRunner.hasTable('stripe_events');
        if (!stripeEventsExists) {
            await queryRunner.createTable(
                new Table({
                    name: 'stripe_events',
                    columns: [
                        {
                            name: 'id',
                            type: 'uuid',
                            isPrimary: true,
                            generationStrategy: 'uuid',
                            default: 'gen_random_uuid()',
                        },
                        {
                            name: 'stripe_event_id',
                            type: 'varchar',
                            isNullable: false,
                            isUnique: true,
                        },
                        {
                            name: 'event_type',
                            type: 'varchar',
                            isNullable: false,
                        },
                        {
                            name: 'processed_at',
                            type: 'timestamp',
                            default: 'CURRENT_TIMESTAMP',
                        },
                    ],
                }),
                true,
            );

            await queryRunner.createIndex(
                'stripe_events',
                new TableIndex({
                    name: 'IDX_STRIPE_EVENTS_EVENT_ID',
                    columnNames: ['stripe_event_id'],
                    isUnique: true,
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('stripe_events', true);

        for (const col of ['stripe_customer_id', 'stripe_subscription_id', 'payment_provider']) {
            const exists = await queryRunner.hasColumn('subscriptions', col);
            if (exists) await queryRunner.dropColumn('subscriptions', col);
        }

        try {
            await queryRunner.dropIndex('payments', 'IDX_PAYMENTS_STRIPE_EVENT_ID');
        } catch { /* ignore */ }

        for (const col of ['stripe_customer_id', 'stripe_subscription_id', 'stripe_session_id', 'stripe_event_id', 'payment_provider']) {
            const exists = await queryRunner.hasColumn('payments', col);
            if (exists) await queryRunner.dropColumn('payments', col);
        }
    }
}
