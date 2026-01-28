import { Controller, Get, Request } from '@nestjs/common';
import { SubscriptionsService, SubscriptionInfo } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /**
   * Get current user's subscription info
   */
  @Get('me')
  async getMySubscription(@Request() req: any): Promise<SubscriptionInfo> {
    const userId = req.user.id;
    return this.subscriptionsService.getSubscriptionInfo(userId);
  }
}

