import { Controller, Get, Param, Query, Res, Request, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { InstancesService } from '../instances/instances.service';
import { SubUsersService } from '../sub-users/sub-users.service';

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly instancesService: InstancesService,
    private readonly subUsersService: SubUsersService,
  ) {}

  // =========================================================================
  // Auth / identity helpers
  // =========================================================================

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
   * For sub-users, checks permission for a specific instance name
   */
  private async ensureSubUserPermission(req: any, instanceName: string): Promise<void> {
    if (!this.isSubUser(req)) return;
    const ownerUserId = req.user.parentUserId;
    const hasPermission = await this.subUsersService.hasPermissionForInstance(
      req.user.id,
      instanceName,
      ownerUserId,
    );
    if (!hasPermission) {
      throw new ForbiddenException('Você não tem permissão para acessar esta instância.');
    }
  }

  // =========================================================================
  // JID normalization & deduplication helpers
  // =========================================================================

  /**
   * Checks whether a JID is a regular WhatsApp contact (@s.whatsapp.net).
   * Filters out @lid, @g.us, @broadcast, etc.
   */
  private isStandardUserJid(jid: string): boolean {
    return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
  }

  /**
   * Checks whether a JID belongs to a WhatsApp group chat (@g.us) or
   * broadcast list (@broadcast).  These are excluded from all endpoints
   * so the app only works with individual (1-to-1) chats.
   */
  private isGroupOrBroadcastJid(jid: string): boolean {
    return typeof jid === 'string' && (jid.endsWith('@g.us') || jid === 'status@broadcast');
  }

  /**
   * Checks whether a JID uses WhatsApp's newer Linked Identifier format.
   */
  private isLidJid(jid: string): boolean {
    return typeof jid === 'string' && jid.endsWith('@lid');
  }

  /**
   * Extracts just the phone-number digits from a JID's local part.
   * For @lid JIDs the format is `phone:deviceId@lid` – we strip the
   * `:deviceId` suffix.  For all other JIDs we return the part before `@`.
   */
  private extractPhoneFromJid(jid: string): { phone: string; domain: string } {
    const atIdx = jid.indexOf('@');
    if (atIdx < 0) return { phone: jid, domain: '' };
    const rawLocal = jid.slice(0, atIdx);
    const domain = jid.slice(atIdx); // includes '@'

    if (domain === '@lid') {
      const colonIdx = rawLocal.indexOf(':');
      const phone = colonIdx >= 0 ? rawLocal.slice(0, colonIdx) : rawLocal;
      return { phone, domain };
    }
    return { phone: rawLocal, domain };
  }

  /**
   * Normalises a phone-number string by applying the Brazilian 9th-digit
   * rule.  Returns a canonical `<number>@s.whatsapp.net` JID regardless
   * of whether the input was @s.whatsapp.net or @lid.
   *
   * Brazilian mobile numbers:
   *   +55 XX 9XXXX-XXXX  (13 digits, canonical)
   *   +55 XX XXXX-XXXX   (12 digits, legacy – missing the leading 9)
   *
   * Non-Brazilian numbers, group JIDs (@g.us), and broadcast JIDs are
   * returned as-is.
   */
  private normalizeJid(jid: string): string {
    if (!jid) return jid;
    const atIdx = jid.indexOf('@');
    if (atIdx < 0) return jid;

    const rawLocal = jid.slice(0, atIdx);
    const { phone, domain } = this.extractPhoneFromJid(jid);

    // For @lid JIDs, map to the canonical @s.whatsapp.net form so they
    // merge with the standard chat entry during deduplication.
    if (domain === '@lid') {
      // Only normalise when we're confident the local part contains a
      // real phone number.  Older WhatsApp versions use the format
      // `phone:deviceId@lid` (colon-separated) where the part before the
      // colon is the actual phone number.  Newer versions use opaque
      // numeric identifiers with NO colon – these can't be reliably
      // mapped to a phone number and must be left as-is so the second
      // deduplication pass can match them by name/pushName instead.
      const hasDeviceId = rawLocal.includes(':');
      if (hasDeviceId && /^\d{10,15}$/.test(phone)) {
        const normalized = this.normalizeBrazilianNumber(phone);
        return `${normalized}@s.whatsapp.net`;
      }
      // Opaque LID – can't normalise, return as-is
      return jid;
    }

    // Only touch @s.whatsapp.net JIDs
    if (domain !== '@s.whatsapp.net') return jid;

    const normalized = this.normalizeBrazilianNumber(phone);
    return `${normalized}${domain}`;
  }

  /**
   * Adds the Brazilian 9th digit to a 12-digit number if applicable.
   * Returns the number string unchanged for non-Brazilian or already-
   * canonical numbers.
   */
  private normalizeBrazilianNumber(phone: string): string {
    if (!phone.startsWith('55')) return phone;
    if (phone.length === 12) {
      return `55${phone.slice(2, 4)}9${phone.slice(4)}`;
    }
    return phone;
  }

  /**
   * Returns all plausible JID variants for a given phone JID so we can
   * query messages stored under any of them.
   *
   * For Brazilian numbers this returns both the 12- and 13-digit forms.
   */
  private getJidVariations(jid: string): string[] {
    if (!jid) return [jid];
    const atIdx = jid.indexOf('@');
    if (atIdx < 0) return [jid];
    const number = jid.slice(0, atIdx);
    const domain = jid.slice(atIdx);

    if (domain !== '@s.whatsapp.net' || !number.startsWith('55')) return [jid];

    const variations: string[] = [jid];
    if (number.length === 13 && number[4] === '9') {
      // With 9th digit → also try without
      variations.push(`55${number.slice(2, 4)}${number.slice(5)}${domain}`);
    } else if (number.length === 12) {
      // Without 9th digit → also try with
      variations.push(`55${number.slice(2, 4)}9${number.slice(4)}${domain}`);
    }
    return variations;
  }

  /**
   * Extracts the chat timestamp (unix seconds) from the Evolution API v2
   * chat object.  The API returns `lastMessage.messageTimestamp` and/or
   * `updatedAt` – NOT `lastMsgTimestamp` or `conversationTimestamp`.
   */
  private getChatTimestamp(chat: any): number {
    // Prefer lastMessage.messageTimestamp (unix seconds)
    const msgTs = chat.lastMessage?.messageTimestamp;
    if (msgTs) {
      if (typeof msgTs === 'object' && msgTs.low != null) return msgTs.low;
      const n = typeof msgTs === 'number' ? msgTs : parseInt(String(msgTs), 10);
      if (n > 0) return n;
    }
    // Fallback: updatedAt (ISO date string)
    if (chat.updatedAt) {
      const ms = new Date(chat.updatedAt).getTime();
      if (!isNaN(ms)) return Math.floor(ms / 1000);
    }
    // Legacy field names (in case a different API version sends them)
    for (const field of ['lastMsgTimestamp', 'conversationTimestamp']) {
      const val = chat[field];
      if (val) {
        if (typeof val === 'object' && val.low != null) return val.low;
        const n = typeof val === 'number' ? val : parseInt(String(val), 10);
        if (n > 0) return n;
      }
    }
    return 0;
  }

  /**
   * Deduplicates the aggregated chat list.
   *
   * 1. Filters out @lid JIDs that have a corresponding @s.whatsapp.net entry
   *    (keeps @lid only when it is the sole chat for that instance+contact).
   * 2. Merges Brazilian number variants (with/without 9th digit) into one
   *    entry, keeping the one with the most recent message and combining
   *    unread counts.
   */
  private deduplicateChats(
    chats: any[],
  ): { chats: any[]; unmatchedLidsByInstance: Map<string, string[]> } {
    // Key = normalizedJid + '|' + instanceName
    const map = new Map<string, { chat: any; allJids: string[] }>();
    // Track which normalised keys have a @s.whatsapp.net entry
    const hasStandardJid = new Set<string>();
    // Collect @lid JIDs that can't be resolved by phone or name matching,
    // grouped by instance – the caller will resolve them via findContacts.
    const unmatchedLidsByInstance = new Map<string, string[]>();

    for (const chat of chats) {
      const rawJid: string = chat.remoteJid || chat.id || '';
      if (!rawJid) continue;

      const normalized = this.normalizeJid(rawJid);
      const key = `${normalized}|${chat.instanceName}`;
      const isStandard = this.isStandardUserJid(rawJid);
      if (isStandard) hasStandardJid.add(key);

      const existing = map.get(key);
      if (!existing) {
        map.set(key, { chat: { ...chat, _allJids: [rawJid] }, allJids: [rawJid] });
      } else {
        // Merge: keep the entry with the most recent message
        existing.allJids.push(rawJid);
        existing.chat._allJids = existing.allJids;

        const existingTs = this.getChatTimestamp(existing.chat);
        const newTs = this.getChatTimestamp(chat);

        if (newTs > existingTs) {
          // New chat is more recent – replace but keep merged data
          const mergedUnread = (existing.chat.unreadCount || 0) + (chat.unreadCount || 0);
          const allJids = [...existing.allJids];
          existing.chat = { ...chat, _allJids: allJids, unreadCount: mergedUnread };
        } else {
          // Existing is more recent – just add unread
          existing.chat.unreadCount =
            (existing.chat.unreadCount || 0) + (chat.unreadCount || 0);
        }

        // Prefer the @s.whatsapp.net JID for display
        if (isStandard && !this.isStandardUserJid(existing.chat.remoteJid)) {
          existing.chat.remoteJid = rawJid;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Second pass – merge remaining @lid entries that couldn't be normalised
    // by phone number.  Newer WhatsApp versions use opaque numeric LIDs that
    // don't contain the phone number, so normalizeJid returns them as-is and
    // they remain unmerged.  We attempt to match them to @s.whatsapp.net
    // chats in the same instance by comparing name / pushName.
    // -----------------------------------------------------------------------
    const unmatchedLidKeys: string[] = [];
    const standardByInstance = new Map<
      string,
      Array<{ key: string; entry: { chat: any; allJids: string[] } }>
    >();

    for (const [key, entry] of map.entries()) {
      const rawJid: string = entry.chat.remoteJid || entry.chat.id || '';
      if (this.isLidJid(rawJid) && !hasStandardJid.has(key)) {
        unmatchedLidKeys.push(key);
      } else if (!this.isLidJid(rawJid)) {
        const inst = entry.chat.instanceName || '';
        if (!standardByInstance.has(inst)) standardByInstance.set(inst, []);
        standardByInstance.get(inst)!.push({ key, entry });
      }
    }

    for (const lidKey of unmatchedLidKeys) {
      const lidEntry = map.get(lidKey);
      if (!lidEntry) continue;

      const lidChat = lidEntry.chat;
      const lidName = (lidChat.name || '').trim().toLowerCase();
      const lidPushName = (lidChat.pushName || '').trim().toLowerCase();
      const lidInstance = lidChat.instanceName || '';
      const candidates = standardByInstance.get(lidInstance) || [];

      let matched = false;

      if (lidName || lidPushName) {
        for (const std of candidates) {
          const stdChat = std.entry.chat;
          const stdName = (stdChat.name || '').trim().toLowerCase();
          const stdPushName = (stdChat.pushName || '').trim().toLowerCase();

          const nameMatch = !!(lidName && stdName && lidName === stdName);
          const pushNameMatch = !!(lidPushName && stdPushName && lidPushName === stdPushName);

          if (nameMatch || pushNameMatch) {
            // Merge the @lid JIDs into the standard chat's _allJids
            for (const jid of lidEntry.allJids) {
              if (!std.entry.allJids.includes(jid)) {
                std.entry.allJids.push(jid);
              }
            }
            std.entry.chat._allJids = std.entry.allJids;

            // Merge unread counts
            std.entry.chat.unreadCount =
              (std.entry.chat.unreadCount || 0) + (lidChat.unreadCount || 0);

            // If the @lid chat has a more recent last message, adopt it
            const existingTs = this.getChatTimestamp(std.entry.chat);
            const lidTs = this.getChatTimestamp(lidChat);
            if (lidTs > existingTs && lidChat.lastMessage) {
              std.entry.chat.lastMessage = lidChat.lastMessage;
            }

            map.delete(lidKey);
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        // Collect unmatched @lid JIDs so the caller can resolve them via
        // the Evolution API contacts endpoint (which provides the
        // authoritative lid → phoneNumber mapping from Baileys).
        if (!unmatchedLidsByInstance.has(lidInstance)) {
          unmatchedLidsByInstance.set(lidInstance, []);
        }
        for (const jid of lidEntry.allJids) {
          unmatchedLidsByInstance.get(lidInstance)!.push(jid);
        }
        map.delete(lidKey);
      }
    }

    // Filter out @lid-only entries when a standard JID exists for the same key
    const result: any[] = [];
    for (const [key, entry] of map.entries()) {
      const rawJid: string = entry.chat.remoteJid || entry.chat.id || '';
      // If this entry is LID-only and a standard JID exists for the same
      // normalised key, skip it (it was already merged above).
      if (this.isLidJid(rawJid) && hasStandardJid.has(key)) continue;
      result.push(entry.chat);
    }
    return { chats: result, unmatchedLidsByInstance };
  }

  /**
   * Resolves unmatched @lid JIDs by calling the Evolution API's findContacts
   * endpoint.  Baileys' Contact type exposes both `lid` (@lid JID) and
   * `phoneNumber` (@s.whatsapp.net JID) for every contact, giving us the
   * authoritative mapping.
   *
   * For each resolved LID, the corresponding @s.whatsapp.net chat's
   * `_allJids` is updated so that subsequent message fetches will query
   * the @lid JID and return the missing self-sent messages.
   */
  private async resolveUnmatchedLids(
    baseUrl: string,
    apiKey: string,
    chats: any[],
    unmatchedLidsByInstance: Map<string, string[]>,
    userInstances: any[],
  ): Promise<void> {
    for (const [instanceName, lidJids] of unmatchedLidsByInstance.entries()) {
      const inst = userInstances.find((i: any) => i.displayName === instanceName);
      if (!inst) continue;

      try {
        const contactsUrl = `${baseUrl}/chat/findContacts/${encodeURIComponent(inst.fullName)}`;
        const contactsResp = await fetch(contactsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({}),
        });

        if (!contactsResp.ok) {
          console.warn(
            `resolveUnmatchedLids: findContacts failed for ${instanceName}: HTTP ${contactsResp.status}`,
          );
          continue;
        }

        const contacts = await contactsResp.json();
        if (!Array.isArray(contacts)) continue;

        // Build a LID → phone JID mapping from the Baileys Contact objects.
        // Baileys stores:
        //   contact.lid          – @lid JID
        //   contact.phoneNumber  – @s.whatsapp.net JID
        //   contact.id           – primary id (may be either format)
        const lidToPhone = new Map<string, string>();
        for (const contact of contacts) {
          const lid: string | undefined = contact.lid || contact.lidJid;
          // Prefer phoneNumber, fall back to id if it's a standard JID
          let phone: string | undefined = contact.phoneNumber;
          if (!phone) {
            const id: string = contact.id || contact.remoteJid || '';
            if (id.endsWith('@s.whatsapp.net')) phone = id;
          }
          if (lid && phone) {
            lidToPhone.set(lid, phone);
          }
        }

        // Merge resolved LIDs into the correct chats
        for (const lidJid of lidJids) {
          const phoneJid = lidToPhone.get(lidJid);
          if (!phoneJid) {
            console.warn(
              `resolveUnmatchedLids: no contact mapping for @lid "${lidJid}" ` +
                `in instance "${instanceName}"`,
            );
            continue;
          }

          // Find the standard chat that matches this phone JID
          // (account for Brazilian 9th-digit variants)
          const phoneVariations = this.getJidVariations(phoneJid);
          const chat = chats.find(
            (c) =>
              c.instanceName === instanceName &&
              (phoneVariations.includes(c.remoteJid) ||
                (c._allJids && c._allJids.some((j: string) => phoneVariations.includes(j)))),
          );

          if (chat) {
            if (!chat._allJids) chat._allJids = [chat.remoteJid || chat.id];
            if (!chat._allJids.includes(lidJid)) {
              chat._allJids.push(lidJid);
            }
          } else {
            console.warn(
              `resolveUnmatchedLids: found phone JID "${phoneJid}" for LID "${lidJid}" ` +
                `but no matching chat in instance "${instanceName}"`,
            );
          }
        }
      } catch (error) {
        console.error(
          `resolveUnmatchedLids: error fetching contacts for ${instanceName}:`,
          error,
        );
      }
    }
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

          // Tag each chat with the instance display name and filter out
          // group chats / broadcast lists – only individual chats are kept.
          const taggedChats = chats
            .filter((chat: any) => {
              const jid = chat.remoteJid || chat.id || '';
              return !this.isGroupOrBroadcastJid(jid);
            })
            .map((chat: any) => ({
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
      const rawChats = results.flatMap((r) => r.chats);
      const instanceStatuses = results.map((r) => ({
        name: r.name,
        connected: r.connected,
      }));

      // 6. Deduplicate chats (merges Brazilian 9th-digit variants, filters @lid dupes)
      const { chats: allChats, unmatchedLidsByInstance } = this.deduplicateChats(rawChats);

      // 7. Resolve any remaining @lid JIDs via the contacts API
      if (unmatchedLidsByInstance.size > 0) {
        await this.resolveUnmatchedLids(
          normalizedBaseUrl,
          apiKey,
          allChats,
          unmatchedLidsByInstance,
          userInstances,
        );
      }

      // 8. Sort by most recent message timestamp (descending)
      //    Evolution API v2 returns timestamps inside lastMessage.messageTimestamp
      //    or updatedAt – NOT at the top-level lastMsgTimestamp field.
      allChats.sort((a: any, b: any) => {
        return this.getChatTimestamp(b) - this.getChatTimestamp(a);
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

  /**
   * Fetches message records from Evolution API for a single JID.
   * Returns the extracted records array (may be empty).
   *
   * This method NEVER throws – any error is logged and an empty array
   * is returned so that `Promise.all` across JID variations always
   * resolves and partial results from other variations are preserved.
   */
  private async fetchMessagesForJid(
    baseUrl: string,
    apiKey: string,
    prefixedInstanceName: string,
    remoteJid: string,
  ): Promise<any[]> {
    try {
      const url = `${baseUrl}/chat/findMessages/${encodeURIComponent(prefixedInstanceName)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({
          where: { key: { remoteJid } },
          offset: 100,
          page: 1,
        }),
      });

      if (!response.ok) {
        console.warn(
          `fetchMessagesForJid: HTTP ${response.status} for ${remoteJid} on ${prefixedInstanceName}`,
        );
        return [];
      }

      const data = await response.json();
      if (data?.messages?.records && Array.isArray(data.messages.records)) {
        return data.messages.records;
      }
      if (Array.isArray(data?.messages)) return data.messages;
      if (Array.isArray(data)) return data;
      return [];
    } catch (error) {
      console.error(
        `fetchMessagesForJid: error for ${remoteJid} on ${prefixedInstanceName}:`,
        error,
      );
      return [];
    }
  }

  /**
   * GET /messages/:instanceName/:remoteJid?allJids=jid1,jid2,...
   *
   * Fetches messages for a specific chat from the Evolution API v2
   * endpoint: POST /chat/findMessages/:prefixedInstanceName
   *
   * To handle:
   *   - Brazilian 9th-digit variants (same contact under two phone formats)
   *   - WhatsApp LID JIDs (sent messages stored under @lid instead of
   *     @s.whatsapp.net)
   *
   * this endpoint queries ALL plausible JID variations in parallel and
   * merges the results, deduplicating by message key id.
   *
   * The optional `allJids` query parameter lets the frontend pass every
   * JID variant that was discovered during chat-list deduplication
   * (including @lid JIDs).
   */
  @Get(':instanceName/:remoteJid')
  async getMessages(
    @Param('instanceName') instanceName: string,
    @Param('remoteJid') remoteJid: string,
    @Query('allJids') allJidsParam: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    try {
      await this.ensureSubUserPermission(req, instanceName);
      const effectiveUserId = this.getEffectiveUserId(req);
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
      const prefixedInstanceName = this.instancesService.getPrefixedInstanceName(
        effectiveUserId,
        instanceName,
      );

      // Collect every JID we need to query --------------------------------
      const jidsToQuery = new Set<string>();
      const decodedJid = decodeURIComponent(remoteJid);

      // Primary JID + its Brazilian 9th-digit variants
      for (const v of this.getJidVariations(decodedJid)) {
        jidsToQuery.add(v);
      }

      // Additional JIDs from the allJids query param (e.g. @lid JIDs that
      // were merged during chat-list deduplication)
      if (allJidsParam) {
        for (const raw of allJidsParam.split(',')) {
          const decoded = decodeURIComponent(raw.trim());
          if (!decoded) continue;
          jidsToQuery.add(decoded);
          // Also add Brazilian variants for each additional JID
          for (const v of this.getJidVariations(decoded)) {
            jidsToQuery.add(v);
          }
        }
      }

      // Query all JIDs in parallel ----------------------------------------
      const allRecordArrays = await Promise.all(
        [...jidsToQuery].map((jid) =>
          this.fetchMessagesForJid(normalizedBaseUrl, apiKey, prefixedInstanceName, jid),
        ),
      );

      // Merge and deduplicate by message key id ---------------------------
      const seenIds = new Set<string>();
      const mergedRecords: any[] = [];
      for (const records of allRecordArrays) {
        for (const record of records) {
          const keyId = record.key?.id || record.id;
          if (keyId && seenIds.has(keyId)) continue;
          if (keyId) seenIds.add(keyId);
          mergedRecords.push(record);
        }
      }

      return res.json({
        messages: mergedRecords,
        total: mergedRecords.length,
        pages: 1,
        currentPage: 1,
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return res.status(403).json({ error: error.message });
      }
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }
}
