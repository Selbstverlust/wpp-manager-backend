import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';

export interface RealtimeEnvelope {
  event: string;
  fullInstanceName: string;
  instanceName: string;
  ownerUserId: string;
  payload: any;
}

type RealtimeListener = (envelope: RealtimeEnvelope) => void;

@Injectable()
export class MessagesRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagesRealtimeService.name);
  private readonly socketsByInstance = new Map<string, Socket>();
  private readonly listeners = new Set<RealtimeListener>();
  /** Tracks which full instance names each owner user wants to watch. */
  private readonly instancesByUser = new Map<string, Set<string>>();
  private readonly wantedEvents = [
    'MESSAGES_UPSERT',
    'MESSAGES_UPDATE',
    'MESSAGES_DELETE',
    'CHATS_UPSERT',
    'CHATS_UPDATE',
    'CHATS_DELETE',
    'CONNECTION_UPDATE',
    'SEND_MESSAGE',
  ];

  /**
   * Replaces the set of instances watched on behalf of a specific owner user,
   * then recomputes the global union. Instances no longer needed by any user
   * are disconnected; new ones get a socket opened.
   */
  setWatchedInstancesForUser(ownerUserId: string, fullInstanceNames: string[]): void {
    const next = new Set(fullInstanceNames.filter(Boolean));
    this.instancesByUser.set(ownerUserId, next);
    this.reconcileSockets();
  }

  /**
   * Removes all watched instances for a user (e.g. when they disconnect).
   * Instances no longer needed by any remaining user are disconnected.
   */
  removeWatchedInstancesForUser(ownerUserId: string): void {
    this.instancesByUser.delete(ownerUserId);
    this.reconcileSockets();
  }

  emitOptimisticMessage(params: {
    instanceName: string;
    fullInstanceName: string;
    ownerUserId: string;
    payload: any;
  }): void {
    this.notifyListeners({
      event: 'SEND_MESSAGE',
      instanceName: params.instanceName,
      fullInstanceName: params.fullInstanceName,
      ownerUserId: params.ownerUserId,
      payload: params.payload,
    });
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private reconcileSockets(): void {
    // Build the union of all instances wanted by any user.
    const globalWanted = new Set<string>();
    for (const instances of this.instancesByUser.values()) {
      for (const name of instances) globalWanted.add(name);
    }

    // Open sockets for newly wanted instances.
    for (const name of globalWanted) {
      this.ensureSocket(name);
    }

    // Close sockets for instances no longer wanted by anyone.
    for (const [name, socket] of this.socketsByInstance.entries()) {
      if (!globalWanted.has(name)) {
        socket.disconnect();
        this.socketsByInstance.delete(name);
      }
    }
  }

  private notifyListeners(envelope: RealtimeEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch (error) {
        this.logger.error('Realtime listener failed', error as any);
      }
    }
  }

  private ensureSocket(fullInstanceName: string): void {
    if (this.socketsByInstance.has(fullInstanceName)) return;
    const baseUrl = (process.env.WPP_API_BASE_URL || '').replace(/\/$/, '');
    const apiKey = process.env.WPP_API_KEY || '';
    if (!baseUrl || !apiKey) return;

    const socketUrl = `${baseUrl}/${encodeURIComponent(fullInstanceName)}`;
    const socket = io(socketUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 10000,
      timeout: 15000,
      extraHeaders: { apikey: apiKey },
    });

    socket.on('connect', () => {
      this.logger.log(`Evolution WS connected: ${fullInstanceName}`);
    });
    socket.on('disconnect', (reason) => {
      this.logger.warn(`Evolution WS disconnected (${fullInstanceName}): ${reason}`);
    });
    socket.on('connect_error', (error) => {
      this.logger.warn(`Evolution WS error (${fullInstanceName}): ${error.message}`);
    });

    for (const eventName of this.wantedEvents) {
      socket.on(eventName, (payload: any) => {
        const ownerUserId = this.extractOwnerUserId(fullInstanceName);
        const instanceName = this.extractDisplayInstanceName(fullInstanceName);
        this.notifyListeners({
          event: eventName,
          fullInstanceName,
          instanceName,
          ownerUserId,
          payload,
        });
      });
    }

    this.socketsByInstance.set(fullInstanceName, socket);
  }

  private extractOwnerUserId(fullInstanceName: string): string {
    const idx = fullInstanceName.indexOf('_');
    return idx > 0 ? fullInstanceName.slice(0, idx) : '';
  }

  private extractDisplayInstanceName(fullInstanceName: string): string {
    const idx = fullInstanceName.indexOf('_');
    return idx > 0 ? fullInstanceName.slice(idx + 1) : fullInstanceName;
  }

  onModuleDestroy(): void {
    for (const socket of this.socketsByInstance.values()) {
      socket.disconnect();
    }
    this.socketsByInstance.clear();
    this.instancesByUser.clear();
  }
}

