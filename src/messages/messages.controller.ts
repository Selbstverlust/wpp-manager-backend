import { Controller, Get, Res, Request } from '@nestjs/common';
import { Response } from 'express';
import { InstancesService } from '../instances/instances.service';
import { SubUsersService } from '../sub-users/sub-users.service';

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly instancesService: InstancesService,
    private readonly subUsersService: SubUsersService,
  ) {}

  /**
   * Resolves the effective userId for external API calls.
   * For sub-users, uses the parent's userId. For regular users, uses their own id.
   */
  private getEffectiveUserId(req: any): string {
    return req.user.parentUserId || req.user.id;
  }

  /**
   * Checks if the current user is a sub-user
   */
  private isSubUser(req: any): boolean {
    return !!req.user.parentUserId;
  }

  /**
   * GET /messages/chats
   *
   * Aggregates recent chats from all the user's instances via Evolution API v2
   * endpoint: POST /chat/findChats/:instanceName
   *
   * Returns a unified list of chats tagged with the originating instance name,
   * sorted by most recent message timestamp.
   */
  @Get('chats')
  async getChats(@Request() req: any, @Res() res: Response) {
    try {
      const effectiveUserId = this.getEffectiveUserId(req);
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

      // 1. Fetch all instances from Evolution API v2: GET /instance/fetchInstances
      const instancesUrl = `${normalizedBaseUrl}/instance/fetchInstances`;
      const instancesResponse = await fetch(instancesUrl, {
        method: 'GET',
        headers: { 'apikey': apiKey },
      });

      if (!instancesResponse.ok) {
        return res.status(instancesResponse.status).json({
          error: 'Failed to fetch instances',
        });
      }

      const allInstances = await instancesResponse.json();

      // 2. Filter instances by effective user ID prefix
      let userInstances = allInstances
        .filter((instance: any) => {
          const instanceName = instance.name || instance.instanceName;
          return instanceName && instanceName.startsWith(`${effectiveUserId}_`);
        })
        .map((instance: any) => {
          const instanceName = instance.name || instance.instanceName;
          return {
            ...instance,
            fullName: instanceName,
            displayName: this.instancesService.stripUserPrefix(instanceName, effectiveUserId),
          };
        });

      // 3. If sub-user, filter to only permitted instances
      if (this.isSubUser(req)) {
        const filtered: any[] = [];
        for (const inst of userInstances) {
          const hasPermission = await this.subUsersService.hasPermissionForInstance(
            req.user.id,
            inst.displayName,
            effectiveUserId,
          );
          if (hasPermission) {
            filtered.push(inst);
          }
        }
        userInstances = filtered;
      }

      // 4. Fetch chats from each instance in parallel via Evolution API v2:
      //    POST /chat/findChats/:instanceName
      //    Disconnected instances will fail gracefully and return empty arrays.
      const chatPromises = userInstances.map(async (inst: any) => {
        try {
          const chatsUrl = `${normalizedBaseUrl}/chat/findChats/${encodeURIComponent(inst.fullName)}`;
          const chatsResponse = await fetch(chatsUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': apiKey,
            },
            body: JSON.stringify({}),
          });

          if (!chatsResponse.ok) {
            console.warn(`findChats failed for ${inst.displayName}: HTTP ${chatsResponse.status}`);
            return { chats: [], connected: false, name: inst.displayName };
          }

          const chats = await chatsResponse.json();

          if (!Array.isArray(chats)) {
            return { chats: [], connected: true, name: inst.displayName };
          }

          // Tag each chat with the instance display name
          const taggedChats = chats.map((chat: any) => ({
            ...chat,
            instanceName: inst.displayName,
          }));

          return { chats: taggedChats, connected: true, name: inst.displayName };
        } catch (error) {
          console.error(`Error fetching chats for ${inst.displayName}:`, error);
          return { chats: [], connected: false, name: inst.displayName };
        }
      });

      const results = await Promise.all(chatPromises);

      // 5. Aggregate all chats
      const allChats = results.flatMap((r) => r.chats);
      const instanceStatuses = results.map((r) => ({
        name: r.name,
        connected: r.connected,
      }));

      // 6. Sort by most recent message timestamp (descending)
      // Evolution API v2 uses Unix timestamps (seconds) for lastMsgTimestamp / conversationTimestamp
      allChats.sort((a: any, b: any) => {
        const timeA = a.lastMsgTimestamp || a.conversationTimestamp || 0;
        const timeB = b.lastMsgTimestamp || b.conversationTimestamp || 0;
        const normalizedA = typeof timeA === 'object' && timeA.low != null
          ? timeA.low
          : (typeof timeA === 'number' ? timeA : parseInt(String(timeA), 10) || 0);
        const normalizedB = typeof timeB === 'object' && timeB.low != null
          ? timeB.low
          : (typeof timeB === 'number' ? timeB : parseInt(String(timeB), 10) || 0);
        return normalizedB - normalizedA;
      });

      return res.json({
        chats: allChats,
        instances: instanceStatuses,
        totalInstances: userInstances.length,
        connectedInstances: instanceStatuses.filter((i) => i.connected).length,
      });
    } catch (error) {
      console.error('Error fetching messages/chats:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }
}
