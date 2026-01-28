import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionTier, SubscriptionStatus } from './subscription.entity';

export interface SubscriptionInfo {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  startedAt: Date;
  expiresAt: Date | null;
  isPremium: boolean;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly repo: Repository<Subscription>,
  ) {}

  /**
   * Get or create subscription for a user
   */
  async getOrCreateSubscription(userId: string): Promise<Subscription> {
    let subscription = await this.repo.findOne({ where: { userId } });

    if (!subscription) {
      subscription = this.repo.create({
        userId,
        tier: SubscriptionTier.FREE,
        status: SubscriptionStatus.ACTIVE,
      });
      subscription = await this.repo.save(subscription);
    }

    return subscription;
  }

  /**
   * Get subscription for a user (returns null if not found)
   */
  async getUserSubscription(userId: string): Promise<Subscription | null> {
    return this.repo.findOne({ where: { userId } });
  }

  /**
   * Get subscription info formatted for API response
   */
  async getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
    const subscription = await this.getOrCreateSubscription(userId);
    
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
   * Check if user has premium access
   */
  async isUserPremium(userId: string): Promise<boolean> {
    const subscription = await this.getUserSubscription(userId);
    
    if (!subscription) {
      return false;
    }

    return subscription.isPremium();
  }

  /**
   * Update subscription tier and optionally set expiration
   */
  async updateSubscription(
    userId: string,
    tier: SubscriptionTier,
    expiresAt?: Date | null,
  ): Promise<Subscription> {
    let subscription = await this.getOrCreateSubscription(userId);

    subscription.tier = tier;
    subscription.status = SubscriptionStatus.ACTIVE;
    
    if (expiresAt !== undefined) {
      subscription.expiresAt = expiresAt;
    }

    // If upgrading from free, set started_at to now
    if (tier !== SubscriptionTier.FREE) {
      subscription.startedAt = new Date();
    }

    return this.repo.save(subscription);
  }

  /**
   * Cancel a subscription (revoke premium)
   */
  async cancelSubscription(userId: string): Promise<Subscription> {
    const subscription = await this.getOrCreateSubscription(userId);
    
    subscription.status = SubscriptionStatus.CANCELLED;
    subscription.tier = SubscriptionTier.FREE;
    
    return this.repo.save(subscription);
  }

  /**
   * Get all subscriptions (for admin)
   */
  async getAllSubscriptions(): Promise<Subscription[]> {
    return this.repo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }
}

