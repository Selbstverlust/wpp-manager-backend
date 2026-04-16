import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { InstancesModule } from '../instances/instances.module';
import { SubUsersModule } from '../sub-users/sub-users.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MessagesGateway } from './messages.gateway';
import { MessagesRealtimeService } from './messages-realtime.service';
import { MessagesWebhookDedupService } from './messages-webhook-dedup.service';

@Module({
  imports: [InstancesModule, SubUsersModule, AuthModule, UsersModule],
  controllers: [MessagesController],
  providers: [MessagesGateway, MessagesRealtimeService, MessagesWebhookDedupService],
  exports: [MessagesRealtimeService, MessagesWebhookDedupService],
})
export class MessagesModule {}
