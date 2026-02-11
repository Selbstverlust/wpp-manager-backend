import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instance } from './instance.entity';
import { InstancesService } from './instances.service';
import { InstancesController } from './instances.controller';
import { UsersModule } from '../users/users.module';
import { ExamplePromptsModule } from '../example-prompts/example-prompts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SubUsersModule } from '../sub-users/sub-users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Instance]),
    UsersModule,
    ExamplePromptsModule,
    SubscriptionsModule,
    forwardRef(() => SubUsersModule),
  ],
  providers: [InstancesService],
  controllers: [InstancesController],
  exports: [InstancesService],
})
export class InstancesModule {}


