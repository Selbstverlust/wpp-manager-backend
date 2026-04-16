import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory deduplication store for incoming Evolution API webhook deliveries.
 * Keyed on the message key identifier from the webhook envelope.
 * Entries expire after 24 hours.
 */
@Injectable()
export class MessagesWebhookDedupService implements OnModuleInit, OnModuleDestroy {
  private readonly store = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    // Purge expired entries hourly.
    this.cleanupTimer = setInterval(() => this.purgeExpired(), 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /** Returns true if this key was already processed within the last 24 hours. */
  isProcessed(key: string): boolean {
    const ts = this.store.get(key);
    if (ts === undefined) return false;
    if (Date.now() - ts > TTL_MS) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** Records the key as processed at the current time. */
  markProcessed(key: string): void {
    this.store.set(key, Date.now());
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [key, ts] of this.store.entries()) {
      if (ts < cutoff) this.store.delete(key);
    }
  }
}
