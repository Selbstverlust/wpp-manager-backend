import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { UsersModule } from './users/users.module';
import { InstancesModule } from './instances/instances.module';
import { ExamplePromptsModule } from './example-prompts/example-prompts.module';
import { AuthModule } from './auth/auth.module';
import { PublicAuthGuard } from './auth/public-auth.guard';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { AdminModule } from './admin/admin.module';
import { PaypalModule } from './paypal/paypal.module';
import { SubUsersModule } from './sub-users/sub-users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      // In development, automatically create/update tables to match entities
      synchronize: process.env.NODE_ENV !== 'production',
      // Load entities without needing to register feature modules
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      // Load migrations
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      // Run migrations automatically on startup in production
      migrationsRun: process.env.NODE_ENV === 'production',
    }),
    AuthModule,
    UsersModule,
    InstancesModule,
    ExamplePromptsModule,
    SubscriptionsModule,
    AdminModule,
    PaypalModule,
    SubUsersModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: PublicAuthGuard,
    },
  ],
})
export class AppModule { }


