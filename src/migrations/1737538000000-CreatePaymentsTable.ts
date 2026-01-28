import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreatePaymentsTable1737538000000 implements MigrationInterface {
    name = 'CreatePaymentsTable1737538000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'payments',
                columns: [
                    {
                        name: 'id',
                        type: 'uuid',
                        isPrimary: true,
                        generationStrategy: 'uuid',
                        default: 'gen_random_uuid()',
                    },
                    {
                        name: 'user_id',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'paypal_subscription_id',
                        type: 'varchar',
                        isNullable: true,
                    },
                    {
                        name: 'paypal_payer_id',
                        type: 'varchar',
                        isNullable: true,
                    },
                    {
                        name: 'amount',
                        type: 'decimal',
                        precision: 10,
                        scale: 2,
                        isNullable: false,
                    },
                    {
                        name: 'currency',
                        type: 'varchar',
                        length: '3',
                        default: "'BRL'",
                    },
                    {
                        name: 'status',
                        type: 'varchar',
                        default: "'pending'",
                    },
                    {
                        name: 'subscription_tier',
                        type: 'varchar',
                        default: "'pro'",
                    },
                    {
                        name: 'created_at',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'updated_at',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'completed_at',
                        type: 'timestamp',
                        isNullable: true,
                    },
                ],
            }),
            true,
        );

        // Add indexes
        await queryRunner.createIndex(
            'payments',
            new TableIndex({
                name: 'IDX_PAYMENTS_USER_ID',
                columnNames: ['user_id'],
            }),
        );

        await queryRunner.createIndex(
            'payments',
            new TableIndex({
                name: 'IDX_PAYMENTS_PAYPAL_SUBSCRIPTION_ID',
                columnNames: ['paypal_subscription_id'],
            }),
        );

        // Add foreign key
        await queryRunner.createForeignKey(
            'payments',
            new TableForeignKey({
                name: 'FK_PAYMENTS_USER',
                columnNames: ['user_id'],
                referencedTableName: 'users',
                referencedColumnNames: ['id'],
                onDelete: 'CASCADE',
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropForeignKey('payments', 'FK_PAYMENTS_USER');
        await queryRunner.dropIndex('payments', 'IDX_PAYMENTS_PAYPAL_SUBSCRIPTION_ID');
        await queryRunner.dropIndex('payments', 'IDX_PAYMENTS_USER_ID');
        await queryRunner.dropTable('payments');
    }
}
