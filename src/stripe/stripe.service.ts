import {
    Injectable,
    Logger,
    OnModuleInit,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeConstructor = require('stripe');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StripeInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StripeEventObj = any;
import { StripeEvent } from './stripe-event.entity';
import { Payment, PaymentStatus } from '../paypal/payment.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionTier, PaymentProvider } from '../subscriptions/subscription.entity';

@Injectable()
export class StripeService implements OnModuleInit {
    private readonly logger = new Logger(StripeService.name);
    private client: StripeInstance;

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(StripeEvent)
        private readonly stripeEventRepo: Repository<StripeEvent>,
        @InjectRepository(Payment)
        private readonly paymentRepo: Repository<Payment>,
        private readonly subscriptionsService: SubscriptionsService,
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

        this.client = new StripeConstructor(secretKey);
        this.logger.log('Stripe SDK initialized');
    }

    getClient(): StripeInstance {
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

    /**
     * R15: Get or create Stripe Customer for a user.
     * Returns the stripeCustomerId.
     */
    async getOrCreateStripeCustomer(userId: string, userEmail: string): Promise<string> {
        const subscription = await this.subscriptionsService.getOrCreateSubscription(userId);

        if (subscription.stripeCustomerId) {
            return subscription.stripeCustomerId;
        }

        const customer = await this.client.customers.create({ email: userEmail });
        await this.subscriptionsService.saveStripeCustomerId(userId, customer.id);
        return customer.id;
    }

    /**
     * R16: Create a Stripe Checkout Session (called from controller T-092).
     */
    async createCheckoutSession(
        userId: string,
        userEmail: string,
        successUrl: string,
        cancelUrl: string,
    ): Promise<{ sessionId: string; checkoutUrl: string }> {
        // Provider conflict check (R16)
        const subscription = await this.subscriptionsService.getOrCreateSubscription(userId);
        if (
            subscription.isPremium() &&
            subscription.paymentProvider === PaymentProvider.PAYPAL
        ) {
            throw new ConflictException(
                'Active PayPal subscription exists. Cancel it before switching to Stripe.',
            );
        }

        const stripeCustomerId = await this.getOrCreateStripeCustomer(userId, userEmail);
        const priceId = this.getPriceId();

        const session = await this.client.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        // Create pending payment record with idempotency key
        const idempotencyKey = crypto.randomUUID();
        const payment = this.paymentRepo.create({
            userId,
            amount: 0,
            currency: this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL',
            status: PaymentStatus.PENDING,
            subscriptionTier: SubscriptionTier.PRO,
            stripeSessionId: session.id,
            stripeCustomerId,
            paymentProvider: PaymentProvider.STRIPE,
            stripeEventId: idempotencyKey,
        });
        await this.paymentRepo.save(payment);

        return { sessionId: session.id, checkoutUrl: session.url! };
    }

    /**
     * R17: Verify a completed Stripe Checkout Session and activate subscription.
     */
    async verifyCheckoutSession(userId: string, sessionId: string): Promise<void> {
        const session = await this.client.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== 'paid') {
            throw new BadRequestException('Checkout session is not paid');
        }

        // Find or create payment record
        let payment = await this.paymentRepo.findOne({
            where: { stripeSessionId: sessionId },
        });

        if (!payment) {
            payment = this.paymentRepo.create({
                userId,
                amount: 0,
                currency: this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL',
                status: PaymentStatus.PENDING,
                subscriptionTier: SubscriptionTier.PRO,
                stripeSessionId: sessionId,
                stripeCustomerId: session.customer as string,
                paymentProvider: PaymentProvider.STRIPE,
            });
        }

        payment.status = PaymentStatus.COMPLETED;
        payment.completedAt = new Date();
        await this.paymentRepo.save(payment);

        // Save stripe subscription ID if available
        const stripeSubId = session.subscription as string | null;
        if (stripeSubId) {
            await this.subscriptionsService.saveStripeSubscriptionId(
                userId,
                stripeSubId,
                PaymentProvider.STRIPE,
            );
        }

        await this.subscriptionsService.updateSubscription(userId, SubscriptionTier.PRO);
    }

    /**
     * R18: Handle a Stripe webhook event.
     * Returns false if event should be skipped (dedup/stale), true if processed.
     */
    async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
        const webhookSecret = this.getWebhookSecret();
        let event: StripeEventObj;

        try {
            event = this.client.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch {
            throw new BadRequestException('Invalid webhook signature');
        }

        // R19: dedup check
        if (await this.isEventProcessed(event.id)) {
            this.logger.log(`Skipping already-processed event: ${event.id}`);
            return;
        }

        await this.processWebhookEvent(event);
        await this.markEventProcessed(event.id, event.type);
    }

    private async processWebhookEvent(event: StripeEventObj): Promise<void> {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as any;
                const customerId = session.customer as string;
                const userId = await this.getUserIdFromCustomer(customerId);
                if (userId) {
                    await this.activateFromSession(userId, session);
                }
                break;
            }
            case 'customer.subscription.deleted':
            case 'customer.subscription.updated': {
                const sub = event.data.object as any;
                if (event.type === 'customer.subscription.updated' && sub.status !== 'canceled') {
                    break;
                }
                const customerId = sub.customer as string;
                const userId = await this.getUserIdFromCustomer(customerId);
                if (userId) {
                    // R19: stale event check
                    const subscription = await this.subscriptionsService.getUserSubscription(userId);
                    if (subscription) {
                        const eventCreatedUtc = new Date(event.created * 1000);
                        if (eventCreatedUtc < subscription.startedAt) {
                            this.logger.log(`Discarding stale event ${event.id} — older than subscription startedAt`);
                            return;
                        }
                    }
                    await this.subscriptionsService.cancelSubscription(userId);
                }
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as any;
                const stripeSubId = invoice.subscription as string | null;
                if (stripeSubId) {
                    const payment = await this.paymentRepo.findOne({
                        where: { stripeSubscriptionId: stripeSubId },
                    });
                    if (payment) {
                        payment.status = PaymentStatus.FAILED;
                        await this.paymentRepo.save(payment);
                    }
                }
                break;
            }
            default:
                this.logger.log(`Unhandled Stripe event type: ${event.type}`);
        }
    }

    private async getUserIdFromCustomer(stripeCustomerId: string): Promise<string | null> {
        const payment = await this.paymentRepo.findOne({
            where: { stripeCustomerId, paymentProvider: PaymentProvider.STRIPE },
            order: { createdAt: 'DESC' },
        });
        return payment?.userId ?? null;
    }

    private async activateFromSession(userId: string, session: any): Promise<void> {
        let payment = await this.paymentRepo.findOne({
            where: { stripeSessionId: session.id },
        });

        if (!payment) {
            payment = this.paymentRepo.create({
                userId,
                amount: 0,
                currency: this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL',
                status: PaymentStatus.PENDING,
                subscriptionTier: SubscriptionTier.PRO,
                stripeSessionId: session.id,
                stripeCustomerId: session.customer as string,
                paymentProvider: PaymentProvider.STRIPE,
            });
        }

        payment.status = PaymentStatus.COMPLETED;
        payment.completedAt = new Date();
        await this.paymentRepo.save(payment);

        const stripeSubId = session.subscription as string | null;
        if (stripeSubId) {
            await this.subscriptionsService.saveStripeSubscriptionId(
                userId,
                stripeSubId,
                PaymentProvider.STRIPE,
            );
        }

        await this.subscriptionsService.updateSubscription(userId, SubscriptionTier.PRO);
    }

    /**
     * R21: Cancel active Stripe subscription for a user.
     */
    async cancelStripeSubscription(userId: string): Promise<void> {
        const subscription = await this.subscriptionsService.getUserSubscription(userId);

        if (!subscription?.stripeSubscriptionId) {
            throw new BadRequestException('No active Stripe subscription found');
        }

        await this.client.subscriptions.cancel(subscription.stripeSubscriptionId);

        // Update most recent Stripe payment record
        const payment = await this.paymentRepo.findOne({
            where: { userId, paymentProvider: PaymentProvider.STRIPE },
            order: { createdAt: 'DESC' },
        });

        if (payment) {
            payment.status = PaymentStatus.CANCELLED;
            await this.paymentRepo.save(payment);
        }

        await this.subscriptionsService.cancelSubscription(userId);
    }
}
