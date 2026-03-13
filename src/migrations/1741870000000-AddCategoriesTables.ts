import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey, TableUnique } from 'typeorm';

export class AddCategoriesTables1741870000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create categories table
    await queryRunner.createTable(
      new Table({
        name: 'categories',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'color',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'position',
            type: 'int',
            default: 0,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
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

    await queryRunner.createIndex(
      'categories',
      new TableIndex({
        name: 'IDX_categories_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'categories',
      new TableIndex({
        name: 'IDX_categories_user_position',
        columnNames: ['user_id', 'position'],
      }),
    );

    await queryRunner.createForeignKey(
      'categories',
      new TableForeignKey({
        name: 'FK_categories_user_id',
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    // Create chat_category_assignments table
    await queryRunner.createTable(
      new Table({
        name: 'chat_category_assignments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'category_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'remote_jid',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'instance_name',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createUniqueConstraint(
      'chat_category_assignments',
      new TableUnique({
        name: 'UQ_chat_category_assignment',
        columnNames: ['category_id', 'remote_jid', 'instance_name'],
      }),
    );

    await queryRunner.createIndex(
      'chat_category_assignments',
      new TableIndex({
        name: 'IDX_chat_category_user',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'chat_category_assignments',
      new TableForeignKey({
        name: 'FK_chat_category_category_id',
        columnNames: ['category_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'categories',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'chat_category_assignments',
      new TableForeignKey({
        name: 'FK_chat_category_user_id',
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('chat_category_assignments', 'FK_chat_category_user_id');
    await queryRunner.dropForeignKey('chat_category_assignments', 'FK_chat_category_category_id');
    await queryRunner.dropIndex('chat_category_assignments', 'IDX_chat_category_user');
    await queryRunner.dropUniqueConstraint('chat_category_assignments', 'UQ_chat_category_assignment');
    await queryRunner.dropTable('chat_category_assignments');

    await queryRunner.dropForeignKey('categories', 'FK_categories_user_id');
    await queryRunner.dropIndex('categories', 'IDX_categories_user_position');
    await queryRunner.dropIndex('categories', 'IDX_categories_user_id');
    await queryRunner.dropTable('categories');
  }
}
