import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubUsers1739200000000 implements MigrationInterface {
  name = 'AddSubUsers1739200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add parent_user_id column to users table
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "parent_user_id" uuid NULL
    `);

    // Add index on parent_user_id
    await queryRunner.query(`
      CREATE INDEX "IDX_users_parent_user_id" ON "users" ("parent_user_id")
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "FK_users_parent_user_id"
      FOREIGN KEY ("parent_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // Create sub_user_permissions table
    await queryRunner.query(`
      CREATE TABLE "sub_user_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sub_user_id" uuid NOT NULL,
        "instance_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sub_user_permissions" PRIMARY KEY ("id")
      )
    `);

    // Add unique constraint on (sub_user_id, instance_id)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_sub_user_permissions_unique" ON "sub_user_permissions" ("sub_user_id", "instance_id")
    `);

    // Add indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_sub_user_permissions_sub_user_id" ON "sub_user_permissions" ("sub_user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sub_user_permissions_instance_id" ON "sub_user_permissions" ("instance_id")
    `);

    // Add foreign keys
    await queryRunner.query(`
      ALTER TABLE "sub_user_permissions" ADD CONSTRAINT "FK_sub_user_permissions_sub_user_id"
      FOREIGN KEY ("sub_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "sub_user_permissions" ADD CONSTRAINT "FK_sub_user_permissions_instance_id"
      FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop sub_user_permissions table
    await queryRunner.query(`DROP TABLE "sub_user_permissions"`);

    // Remove foreign key and column from users
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_parent_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_users_parent_user_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "parent_user_id"`);
  }
}
