import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { StripeEvent } from './stripe-event.entity';
import { Payment } from '../paypal/payment.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([StripeEvent, Payment]),
        SubscriptionsModule,
    ],
    controllers: [StripeController],
    providers: [StripeService],
    exports: [StripeService],
})
export class StripeModule {}
