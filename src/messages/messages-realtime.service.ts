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
  /** Confirmed-active sockets (configureInstanceWebsocket succeeded). */
  private readonly socketsByInstance = new Map<string, Socket>();
  /** All socket objects — active or reconnecting. Prevents duplicate creation. */
  private readonly socketRefs = new Map<string, Socket>();
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

  /**
   * Routes an arbitrary envelope through the same listener pipeline used by
   * socket-delivered events. Called by the webhook receiver to provide a
   * fallback delivery path without duplicating relay logic.
   */
  relayEvent(envelope: RealtimeEnvelope): void {
    this.notifyListeners(envelope);
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
    for (const [name, socket] of this.socketRefs.entries()) {
      if (!globalWanted.has(name)) {
        socket.disconnect();
        this.socketsByInstance.delete(name);
        this.socketRefs.delete(name);
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

  /**
   * Calls /websocket/set to enable event emission for this instance.
   * Throws on non-2xx so the caller can decide not to mark the socket active.
   * Fires on every socket `connect` event (initial + reconnect) to re-arm
   * Evolution API event toggles after a server restart (Issue #1559).
   */
  private async configureInstanceWebsocket(
    baseUrl: string,
    apiKey: string,
    fullInstanceName: string,
  ): Promise<void> {
    const url = `${baseUrl}/websocket/set/${encodeURIComponent(fullInstanceName)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        websocket: { enabled: true, events: this.wantedEvents },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const msg = `/websocket/set failed for ${fullInstanceName}: HTTP ${response.status} — ${body}`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    this.logger.log(`WebSocket events configured for: ${fullInstanceName}`);
  }

  /**
   * Awaits /websocket/set and marks the socket active only on success.
   * Called from the `connect` handler so it fires on both initial connect
   * and every reconnect, re-arming Evolution event toggles each time.
   */
  private async activateSocket(
    fullInstanceName: string,
    socket: Socket,
    baseUrl: string,
    apiKey: string,
  ): Promise<void> {
    try {
      await this.configureInstanceWebsocket(baseUrl, apiKey, fullInstanceName);
      // Store as active only if the instance is still tracked (not cleaned up).
      if (this.socketRefs.has(fullInstanceName)) {
        this.socketsByInstance.set(fullInstanceName, socket);
        this.logger.log(`Socket fully active: ${fullInstanceName}`);
      }
    } catch {
      // Error already logged by configureInstanceWebsocket.
      // Remove from active map; socket.io will reconnect and retry activation.
      this.socketsByInstance.delete(fullInstanceName);
    }
  }

  private ensureSocket(fullInstanceName: string): void {
    if (this.socketRefs.has(fullInstanceName)) return; // Already exists (active or reconnecting)

    const baseUrl = (process.env.WPP_API_BASE_URL || '').replace(/\/$/, '');
    const apiKey = process.env.WPP_API_KEY || '';
    if (!baseUrl || !apiKey) {
      this.logger.error(
        'WPP_API_BASE_URL or WPP_API_KEY missing — realtime socket connections disabled',
      );
      return;
    }

    const socketUrl = `${baseUrl}/${fullInstanceName}`;
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
      // Await /websocket/set before marking socket active.
      // Fires on initial connect AND every reconnect (re-arms event toggles).
      void this.activateSocket(fullInstanceName, socket, baseUrl, apiKey);
    });

    socket.on('disconnect', (reason: string) => {
      this.logger.warn(`Evolution WS disconnected (${fullInstanceName}): ${reason}`);
      // Remove from active map. Socket.io will reconnect automatically;
      // the connect handler will re-activate on next successful connect.
      this.socketsByInstance.delete(fullInstanceName);
    });

    socket.on('connect_error', (error: Error) => {
      this.logger.warn(`Evolution WS connect_error (${fullInstanceName}): ${error.message}`);
    });

    socket.on('error', (error: Error) => {
      this.logger.error(`Evolution WS error (${fullInstanceName}): ${String(error)}`);
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

    // Track socket ref immediately for cleanup; socketsByInstance set only after
    // /websocket/set succeeds in activateSocket.
    this.socketRefs.set(fullInstanceName, socket);
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
    for (const socket of this.socketRefs.values()) {
      socket.disconnect();
    }
    this.socketRefs.clear();
    this.socketsByInstance.clear();
    this.instancesByUser.clear();
  }
}

