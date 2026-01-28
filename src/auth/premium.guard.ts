import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException('User not authenticated');
    }

    const isPremium = await this.subscriptionsService.isUserPremium(user.id);

    if (!isPremium) {
      throw new ForbiddenException(
        'Premium subscription required. Please upgrade your plan to access this feature.',
      );
    }

    return true;
  }
}

