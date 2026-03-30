import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { MessagesRealtimeService, RealtimeEnvelope } from './messages-realtime.service';

type WsClient = Socket & {
  data: {
    userId?: string;
    parentUserId?: string | null;
  };
};

@WebSocketGateway({
  namespace: '/messages-realtime',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class MessagesGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly realtimeService: MessagesRealtimeService,
  ) {}

  afterInit(): void {
    this.realtimeService.subscribe((envelope) => this.forwardEnvelope(envelope));
  }

  async handleConnection(@ConnectedSocket() client: WsClient): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload: any = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });
      const user = await this.usersService.findByEmail(payload.email);
      if (!user) {
        client.disconnect(true);
        return;
      }
      client.data.userId = user.id;
      client.data.parentUserId = user.parentUserId || null;
      client.join(this.getRoomForUser(user.id));
      if (user.parentUserId) {
        client.join(this.getRoomForUser(user.parentUserId));
      }
    } catch (error) {
      this.logger.warn(`Socket auth failed: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: WsClient): void {
    client.removeAllListeners();
    // Clean up Evolution API sockets if this user has no more connected clients.
    const ownerUserId = client.data?.parentUserId || client.data?.userId;
    if (ownerUserId) {
      // Only remove if no other socket in the same room is still connected.
      const room = this.getRoomForUser(ownerUserId);
      const roomSockets = this.server.sockets.adapter.rooms.get(room);
      const remainingCount = roomSockets ? roomSockets.size : 0;
      if (remainingCount === 0) {
        this.realtimeService.removeWatchedInstancesForUser(ownerUserId);
      }
    }
  }

  @SubscribeMessage('messages:watch-instances')
  watchInstances(
    @MessageBody() body: { instances?: string[] },
    @ConnectedSocket() client: WsClient,
  ): { ok: true } {
    if (!client.data?.userId) return { ok: true };
    const instances = Array.isArray(body?.instances) ? body.instances : [];
    // Relay is owner-scoped; instance names are display names only.
    const ownerUserId = client.data.parentUserId || client.data.userId;
    const fullNames = instances.map((name) => `${ownerUserId}_${name}`);
    this.realtimeService.setWatchedInstancesForUser(ownerUserId, fullNames);
    return { ok: true };
  }

  private forwardEnvelope(envelope: RealtimeEnvelope): void {
    if (!envelope.ownerUserId) return;
    this.server.to(this.getRoomForUser(envelope.ownerUserId)).emit('messages:event', envelope);
  }

  private extractToken(client: WsClient): string | null {
    const authToken =
      typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : '';
    if (authToken) return authToken.replace(/^Bearer\s+/i, '').trim();
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string') {
      return header.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
  }

  private getRoomForUser(userId: string): string {
    return `user:${userId}`;
  }
}

