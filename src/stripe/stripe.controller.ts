import {
    Controller,
    Post,
    Get,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    Logger,
    BadRequestException,
    Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { Public } from '../auth/public.decorator';

interface CreateSessionDto {
    success_url: string;
    cancel_url: string;
}

interface VerifySessionDto {
    sessionId: string;
}

@Controller('stripe')
export class StripeController {
    private readonly logger = new Logger(StripeController.name);

    constructor(
        private readonly stripeService: StripeService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * R22: Public endpoint returning Stripe plan pricing metadata
     */
    @Public()
    @Get('plan')
    getPlan() {
        const price = this.configService.get('PREMIUM_PRO_PRICE') || '100.00';
        const currency = this.configService.get('PREMIUM_PRO_CURRENCY') || 'BRL';
        return { price, currency, interval: 'month' };
    }

    /**
     * R16: Create a Stripe Checkout Session
     */
    @Post('create-session')
    async createSession(
        @Req() req: any,
        @Body() body: CreateSessionDto,
    ) {
        if (!body.success_url || !body.cancel_url) {
            throw new BadRequestException('success_url and cancel_url are required');
        }

        const userId = req.user.id as string;
        const userEmail = req.user.email as string;

        return this.stripeService.createCheckoutSession(
            userId,
            userEmail,
            body.success_url,
            body.cancel_url,
        );
    }

    /**
     * R17: Verify a completed Stripe Checkout Session
     */
    @Post('verify-session')
    @HttpCode(HttpStatus.OK)
    async verifySession(
        @Req() req: any,
        @Body() body: VerifySessionDto,
    ) {
        const userId = req.user.id as string;
        await this.stripeService.verifyCheckoutSession(userId, body.sessionId);
        return { success: true };
    }

    /**
     * R21: Cancel active Stripe subscription
     */
    @Post('cancel-subscription')
    @HttpCode(HttpStatus.OK)
    async cancelSubscription(@Req() req: any) {
        const userId = req.user.id as string;
        await this.stripeService.cancelStripeSubscription(userId);
        return { success: true };
    }

    /**
     * R18: Stripe webhook handler (public, signature verified in service)
     */
    @Public()
    @Post('webhook')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(
        @Req() req: any,
        @Headers('stripe-signature') signature: string,
    ) {
        try {
            const rawBody: Buffer = req.rawBody;
            if (!rawBody) {
                throw new BadRequestException('Raw body not available');
            }
            await this.stripeService.handleWebhookEvent(rawBody, signature);
        } catch (err: any) {
            // Signature errors bubble up as 400
            if (err?.status === 400 || err?.name === 'BadRequestException') {
                throw err;
            }
            // All other processing errors → log and return 200
            this.logger.error(`Webhook processing error: ${err?.message}`);
        }
        return { received: true };
    }
}
