import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateSubscriptionsTable1736300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create subscriptions table
    await queryRunner.createTable(
      new Table({
        name: 'subscriptions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'tier',
            type: 'varchar',
            default: "'free'",
          },
          {
            name: 'status',
            type: 'varchar',
            default: "'active'",
          },
          {
            name: 'started_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
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
        ],
      }),
      true,
    );

    // Add index on user_id
    await queryRunner.createIndex(
      'subscriptions',
      new TableIndex({
        name: 'IDX_subscriptions_user_id',
        columnNames: ['user_id'],
      }),
    );

    // Add foreign key from subscriptions to users
    await queryRunner.createForeignKey(
      'subscriptions',
      new TableForeignKey({
        name: 'FK_subscriptions_user_id',
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('subscriptions', 'FK_subscriptions_user_id');
    await queryRunner.dropIndex('subscriptions', 'IDX_subscriptions_user_id');
    await queryRunner.dropTable('subscriptions');
  }
}

