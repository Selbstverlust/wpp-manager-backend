import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class FixInstanceNameUniqueConstraint1734613200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old unique index on name only
    await queryRunner.dropIndex('instances', 'IDX_instances_name_unique');

    // Create a new composite unique index on name + user_id
    // This allows different users to have instances with the same name
    await queryRunner.createIndex(
      'instances',
      new TableIndex({
        name: 'IDX_instances_name_user_unique',
        columnNames: ['name', 'user_id'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the composite unique index
    await queryRunner.dropIndex('instances', 'IDX_instances_name_user_unique');

    // Recreate the old unique index on name only
    await queryRunner.createIndex(
      'instances',
      new TableIndex({
        name: 'IDX_instances_name_unique',
        columnNames: ['name'],
        isUnique: true,
      }),
    );
  }
}

