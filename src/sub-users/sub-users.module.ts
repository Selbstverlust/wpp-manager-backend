import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Instance } from '../instances/instance.entity';
import { SubUserPermission } from './sub-user-permission.entity';
import { SubUsersService } from './sub-users.service';
import { SubUsersController } from './sub-users.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Instance, SubUserPermission]),
    SubscriptionsModule,
  ],
  providers: [SubUsersService],
  controllers: [SubUsersController],
  exports: [SubUsersService, TypeOrmModule],
})
export class SubUsersModule {}
