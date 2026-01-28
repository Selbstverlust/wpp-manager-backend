import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaypalController } from './paypal.controller';
import { PaypalService } from './paypal.service';
import { Payment } from './payment.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([Payment]),
        SubscriptionsModule,
    ],
    controllers: [PaypalController],
    providers: [PaypalService],
    exports: [PaypalService],
})
export class PaypalModule { }
