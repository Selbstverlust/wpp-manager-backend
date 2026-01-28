import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { UsersModule } from '../users/users.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [UsersModule, SubscriptionsModule],
  controllers: [AdminController],
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AdminModule {}

