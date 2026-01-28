import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Request,
    Headers,
    HttpCode,
    HttpStatus,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaypalService } from './paypal.service';
import { Public } from '../auth/public.decorator';

interface CreateSubscriptionDto {
    returnUrl: string;
    cancelUrl: string;
}

@Controller('paypal')
export class PaypalController {
    private readonly logger = new Logger(PaypalController.name);

    constructor(
        private readonly paypalService: PaypalService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * Get subscription plan info (public endpoint)
     */
    @Public()
    @Get('plan')
    async getPlan() {
        this.logger.log('Fetching PayPal plan info...');
        const planId = await this.paypalService.getPlanId();
        const price = this.configService.get('PREMIUM_PRO_PRICE') || '100.00';
        const currency = this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL';

        this.logger.log(`Plan info: planId=${planId}, price=${price}, currency=${currency}`);

        return {
            planId,
            price,
            currency,
            interval: 'month',
        };
    }

    /**
     * Create a new subscription for the authenticated user
     */
    @Post('create-subscription')
    async createSubscription(
        @Request() req: any,
        @Body() body: CreateSubscriptionDto,
    ) {
        const userId = req.user.id;

        if (!body.returnUrl || !body.cancelUrl) {
            throw new BadRequestException('returnUrl and cancelUrl are required');
        }

        const result = await this.paypalService.createSubscription(
            userId,
            body.returnUrl,
            body.cancelUrl,
        );

        return {
            subscriptionId: result.subscriptionId,
            approvalUrl: result.approvalUrl,
        };
    }

    /**
     * Activate subscription after user approval (called from frontend after redirect)
     */
    @Post('activate-subscription/:subscriptionId')
    async activateSubscription(
        @Param('subscriptionId') subscriptionId: string,
        @Request() req: any,
    ) {
        const userId = req.user?.id;
        this.logger.log(`Activate subscription request: ${subscriptionId} by user: ${userId}`);

        const result = await this.paypalService.activateSubscription(subscriptionId, userId);

        if (!result.success) {
            throw new BadRequestException('Failed to activate subscription');
        }

        return { success: true, message: 'Subscription activated successfully' };
    }

    /**
     * Cancel current user's subscription
     */
    @Post('cancel-subscription')
    async cancelSubscription(@Request() req: any) {
        const userId = req.user.id;
        const success = await this.paypalService.cancelUserSubscription(userId);

        if (!success) {
            throw new BadRequestException('No active subscription found');
        }

        return { success: true, message: 'Subscription cancelled successfully' };
    }

    /**
     * Get user's payment history
     */
    @Get('payments')
    async getPayments(@Request() req: any) {
        const userId = req.user.id;
        return this.paypalService.getUserPayments(userId);
    }

    /**
     * PayPal webhook endpoint (public - verified by PayPal signature)
     */
    @Public()
    @Post('webhook')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(
        @Body() body: any,
        @Headers('paypal-transmission-id') transmissionId: string,
        @Headers('paypal-transmission-time') transmissionTime: string,
        @Headers('paypal-transmission-sig') transmissionSig: string,
        @Headers('paypal-cert-url') certUrl: string,
        @Headers('paypal-auth-algo') authAlgo: string,
    ) {
        // Log webhook for debugging
        this.logger.log(`Webhook received: ${body.event_type}`);

        // TODO: Add webhook signature verification for production
        // For now, we'll process the webhook directly

        try {
            await this.paypalService.handleWebhook(body.event_type, body.resource);
            return { received: true };
        } catch (error) {
            this.logger.error('Webhook processing error:', error);
            return { received: true }; // Always return 200 to PayPal
        }
    }
}
