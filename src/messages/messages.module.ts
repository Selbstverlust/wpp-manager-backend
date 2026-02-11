import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { InstancesModule } from '../instances/instances.module';
import { SubUsersModule } from '../sub-users/sub-users.module';

@Module({
  imports: [InstancesModule, SubUsersModule],
  controllers: [MessagesController],
})
export class MessagesModule {}
