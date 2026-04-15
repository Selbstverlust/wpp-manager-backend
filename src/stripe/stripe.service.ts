import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import StripeLib = require('stripe');
type StripeClient = StripeLib.Stripe;
import { StripeEvent } from './stripe-event.entity';
import { Payment } from '../paypal/payment.entity';

@Injectable()
export class StripeService implements OnModuleInit {
    private readonly logger = new Logger(StripeService.name);
    private client: StripeClient;

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(StripeEvent)
        private readonly stripeEventRepo: Repository<StripeEvent>,
        @InjectRepository(Payment)
        private readonly paymentRepo: Repository<Payment>,
    ) {}

    onModuleInit(): void {
        const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
        const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
        const priceId = this.configService.get<string>('STRIPE_PRICE_ID_PRO');

        if (!secretKey) {
            throw new Error('STRIPE_SECRET_KEY is required but not set');
        }
        if (!webhookSecret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is required but not set');
        }
        if (!priceId) {
            throw new Error('STRIPE_PRICE_ID_PRO is required but not set');
        }

        this.client = new StripeLib(secretKey);
        this.logger.log('Stripe SDK initialized');
    }

    getClient(): StripeClient {
        return this.client;
    }

    getWebhookSecret(): string {
        return this.configService.get<string>('STRIPE_WEBHOOK_SECRET')!;
    }

    getPriceId(): string {
        return this.configService.get<string>('STRIPE_PRICE_ID_PRO')!;
    }

    /** R19: Check if a Stripe event has already been processed */
    async isEventProcessed(stripeEventId: string): Promise<boolean> {
        const count = await this.stripeEventRepo.count({ where: { stripeEventId } });
        return count > 0;
    }

    /** R19: Mark a Stripe event as processed (call atomically with state change) */
    async markEventProcessed(stripeEventId: string, eventType: string): Promise<void> {
        const event = this.stripeEventRepo.create({ stripeEventId, eventType });
        await this.stripeEventRepo.save(event);
    }
}
