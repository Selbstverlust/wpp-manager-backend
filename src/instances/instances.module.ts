import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instance } from './instance.entity';
import { InstancesService } from './instances.service';
import { InstancesController } from './instances.controller';
import { UsersModule } from '../users/users.module';
import { ExamplePromptsModule } from '../example-prompts/example-prompts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Instance]),
    UsersModule,
    ExamplePromptsModule,
    SubscriptionsModule,
  ],
  providers: [InstancesService],
  controllers: [InstancesController],
})
export class InstancesModule {}


