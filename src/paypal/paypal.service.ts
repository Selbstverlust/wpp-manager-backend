import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { Payment, PaymentStatus } from './payment.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionTier } from '../subscriptions/subscription.entity';

interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface PayPalProduct {
  id: string;
  name: string;
  description: string;
}

interface PayPalPlan {
  id: string;
  product_id: string;
  name: string;
  status: string;
}

interface PayPalSubscription {
  id: string;
  status: string;
  subscriber: {
    email_address: string;
    payer_id: string;
  };
  billing_info?: {
    last_payment?: {
      amount: {
        currency_code: string;
        value: string;
      };
      time: string;
    };
    next_billing_time?: string;
  };
}

@Injectable()
export class PaypalService implements OnModuleInit {
  private readonly logger = new Logger(PaypalService.name);
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private planId: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    const baseURL = this.configService.get('PAYPAL_MODE') === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    this.axiosInstance = axios.create({ baseURL });
  }

  async onModuleInit() {
    // Ensure we have a valid plan on startup
    try {
      await this.ensurePlanExists();
      this.logger.log(`PayPal initialized with plan ID: ${this.planId}`);
    } catch (error) {
      this.logger.error('Failed to initialize PayPal plan', error);
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && this.tokenExpiresAt > now + 60000) {
      return this.accessToken;
    }

    const clientId = this.configService.get('PAYPAL_CLIENT_ID');
    const clientSecret = this.configService.get('PAYPAL_CLIENT_SECRET');

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await this.axiosInstance.post<PayPalTokenResponse>(
      '/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = now + (response.data.expires_in * 1000);

    return this.accessToken;
  }

  private async ensurePlanExists(): Promise<string> {
    if (this.planId) {
      return this.planId;
    }

    const token = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    // Check for existing active plan
    const plansResponse = await this.axiosInstance.get('/v1/billing/plans', {
      headers,
      params: { page_size: 20, page: 1 },
    });

    const existingPlan = plansResponse.data.plans?.find(
      (p: PayPalPlan) => p.name === 'WPP Manager PRO Monthly' && p.status === 'ACTIVE'
    );

    if (existingPlan) {
      this.planId = existingPlan.id;
      return this.planId;
    }

    // Create product first
    const productResponse = await this.axiosInstance.post<PayPalProduct>(
      '/v1/catalogs/products',
      {
        name: 'WPP Manager PRO',
        description: 'Premium subscription for WPP Manager with unlimited bot instances',
        type: 'SERVICE',
        category: 'SOFTWARE',
      },
      { headers },
    );

    const productId = productResponse.data.id;

    // Create monthly subscription plan
    const price = this.configService.get('PREMIUM_PRO_PRICE') || '100.00';
    const currency = this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL';

    const planResponse = await this.axiosInstance.post<PayPalPlan>(
      '/v1/billing/plans',
      {
        product_id: productId,
        name: 'WPP Manager PRO Monthly',
        description: 'Monthly subscription for WPP Manager PRO features',
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: {
              interval_unit: 'MONTH',
              interval_count: 1,
            },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0, // Infinite
            pricing_scheme: {
              fixed_price: {
                value: price,
                currency_code: currency,
              },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3,
        },
      },
      { headers },
    );

    this.planId = planResponse.data.id;
    this.logger.log(`Created PayPal plan: ${this.planId}`);

    return this.planId;
  }

  /**
   * Create a subscription for a user
   */
  async createSubscription(userId: string, returnUrl: string, cancelUrl: string): Promise<{ subscriptionId: string; approvalUrl: string }> {
    const token = await this.getAccessToken();
    const planId = await this.ensurePlanExists();

    const response = await this.axiosInstance.post(
      '/v1/billing/subscriptions',
      {
        plan_id: planId,
        custom_id: userId, // Store user ID for webhook reference
        application_context: {
          brand_name: 'WPP Manager',
          locale: 'pt-BR',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'SUBSCRIBE_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const subscriptionId = response.data.id;
    const approvalUrl = response.data.links.find((l: any) => l.rel === 'approve')?.href;

    // Create pending payment record
    await this.paymentRepo.save({
      userId,
      paypalSubscriptionId: subscriptionId,
      amount: parseFloat(this.configService.get('PREMIUM_PRO_PRICE') || '100.00'),
      currency: this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL',
      status: PaymentStatus.PENDING,
      subscriptionTier: SubscriptionTier.PRO,
    });

    return { subscriptionId, approvalUrl };
  }

  /**
   * Activate subscription after user approval
   */
  async activateSubscription(subscriptionId: string, userId?: string): Promise<{ success: boolean; userId?: string }> {
    this.logger.log(`Activating subscription: ${subscriptionId} for user: ${userId || 'unknown'}`);

    const token = await this.getAccessToken();

    // Get subscription details from PayPal
    let subscription: PayPalSubscription;
    try {
      const response = await this.axiosInstance.get<PayPalSubscription>(
        `/v1/billing/subscriptions/${subscriptionId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      subscription = response.data;
      this.logger.log(`PayPal subscription status: ${subscription.status}`);
    } catch (error: any) {
      this.logger.error(`Failed to get subscription from PayPal: ${error.message}`);
      return { success: false };
    }

    if (subscription.status !== 'ACTIVE') {
      this.logger.warn(`Subscription ${subscriptionId} is not active: ${subscription.status}`);
      return { success: false };
    }

    // Find or create payment record
    let payment = await this.paymentRepo.findOne({
      where: { paypalSubscriptionId: subscriptionId },
    });

    if (!payment) {
      // Payment record doesn't exist - this happens when using PayPal SDK directly
      // We need a userId to create the record
      if (!userId) {
        this.logger.error(`No payment record and no userId provided for subscription: ${subscriptionId}`);
        return { success: false };
      }

      this.logger.log(`Creating new payment record for subscription: ${subscriptionId}`);
      payment = this.paymentRepo.create({
        userId,
        paypalSubscriptionId: subscriptionId,
        amount: parseFloat(this.configService.get('PREMIUM_PRO_PRICE') || '100.00'),
        currency: this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL',
        status: PaymentStatus.PENDING,
        subscriptionTier: SubscriptionTier.PRO,
      });
    }

    // Update payment status
    payment.status = PaymentStatus.COMPLETED;
    payment.completedAt = new Date();
    payment.paypalPayerId = subscription.subscriber?.payer_id || null;
    await this.paymentRepo.save(payment);

    // Activate user subscription (no expiration for recurring)
    await this.subscriptionsService.updateSubscription(
      payment.userId,
      SubscriptionTier.PRO,
      null, // No expiration - managed by PayPal
    );

    this.logger.log(`Activated subscription for user: ${payment.userId}`);

    return { success: true, userId: payment.userId };
  }

  /**
   * Handle PayPal webhook events
   */
  async handleWebhook(eventType: string, resource: any): Promise<void> {
    this.logger.log(`Received PayPal webhook: ${eventType}`);

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await this.handleSubscriptionActivated(resource);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        await this.handleSubscriptionCancelled(resource);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        await this.handlePaymentCompleted(resource);
        break;

      default:
        this.logger.log(`Unhandled webhook event: ${eventType}`);
    }
  }

  private async handleSubscriptionActivated(resource: any): Promise<void> {
    const subscriptionId = resource.id;
    await this.activateSubscription(subscriptionId);
  }

  private async handleSubscriptionCancelled(resource: any): Promise<void> {
    const subscriptionId = resource.id;

    const payment = await this.paymentRepo.findOne({
      where: { paypalSubscriptionId: subscriptionId },
    });

    if (payment) {
      // Cancel user subscription
      await this.subscriptionsService.cancelSubscription(payment.userId);

      payment.status = PaymentStatus.CANCELLED;
      await this.paymentRepo.save(payment);

      this.logger.log(`Cancelled subscription for user: ${payment.userId}`);
    }
  }

  private async handlePaymentCompleted(resource: any): Promise<void> {
    // Recurring payment received - subscription stays active
    const subscriptionId = resource.billing_agreement_id;

    if (subscriptionId) {
      const payment = await this.paymentRepo.findOne({
        where: { paypalSubscriptionId: subscriptionId },
      });

      if (payment) {
        this.logger.log(`Recurring payment received for user: ${payment.userId}`);
      }
    }
  }

  /**
   * Cancel a user's subscription
   */
  async cancelUserSubscription(userId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findOne({
      where: { userId, status: PaymentStatus.COMPLETED },
      order: { createdAt: 'DESC' },
    });

    if (!payment?.paypalSubscriptionId) {
      return false;
    }

    const token = await this.getAccessToken();

    await this.axiosInstance.post(
      `/v1/billing/subscriptions/${payment.paypalSubscriptionId}/cancel`,
      { reason: 'User requested cancellation' },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    payment.status = PaymentStatus.CANCELLED;
    await this.paymentRepo.save(payment);

    await this.subscriptionsService.cancelSubscription(userId);

    return true;
  }

  /**
   * Get user's payment history
   */
  async getUserPayments(userId: string): Promise<Payment[]> {
    return this.paymentRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get plan ID for frontend
   */
  async getPlanId(): Promise<string> {
    return this.ensurePlanExists();
  }
}
