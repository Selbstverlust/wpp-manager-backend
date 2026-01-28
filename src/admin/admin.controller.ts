import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionTier } from '../subscriptions/subscription.entity';

interface UpdateSubscriptionDto {
  tier: SubscriptionTier;
  expiresAt?: string | null;
}

interface UserWithSubscription {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: Date;
  subscription: {
    id: string;
    tier: SubscriptionTier;
    status: string;
    startedAt: Date;
    expiresAt: Date | null;
    isPremium: boolean;
  } | null;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Get all users with their subscription status
   */
  @Get('users')
  async getAllUsers(): Promise<UserWithSubscription[]> {
    const users = await this.usersService.findAll();
    
    const usersWithSubscriptions = await Promise.all(
      users.map(async (user) => {
        const subscription = await this.subscriptionsService.getUserSubscription(user.id);
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          subscription: subscription
            ? {
                id: subscription.id,
                tier: subscription.tier,
                status: subscription.status,
                startedAt: subscription.startedAt,
                expiresAt: subscription.expiresAt,
                isPremium: subscription.isPremium(),
              }
            : null,
        };
      }),
    );

    return usersWithSubscriptions;
  }

  /**
   * Grant or update subscription for a user
   */
  @Post('users/:id/subscription')
  async updateUserSubscription(
    @Param('id') userId: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    
    const subscription = await this.subscriptionsService.updateSubscription(
      userId,
      body.tier,
      expiresAt,
    );

    return {
      id: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      status: subscription.status,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      isPremium: subscription.isPremium(),
    };
  }

  /**
   * Revoke subscription (set to free tier)
   */
  @Delete('users/:id/subscription')
  async revokeUserSubscription(@Param('id') userId: string) {
    const subscription = await this.subscriptionsService.cancelSubscription(userId);

    return {
      id: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      status: subscription.status,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      isPremium: subscription.isPremium(),
    };
  }
}

