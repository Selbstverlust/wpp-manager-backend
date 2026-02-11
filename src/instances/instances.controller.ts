import { Body, Controller, Get, Param, Put, Res, Post, Request, Delete, Headers, UnauthorizedException, ForbiddenException, UseGuards } from '@nestjs/common';
import { InstancesService } from './instances.service';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PremiumGuard } from '../auth/premium.guard';
import { SubUsersService } from '../sub-users/sub-users.service';

@Controller('instances')
export class InstancesController {
  constructor(
    private readonly service: InstancesService,
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

  /**
   * Public endpoint for n8n to fetch prompt by full instance name (with user prefix)
   * Requires N8N_API_KEY header for authentication
   */
  @Public()
  @Get('n8n/:fullInstanceName/prompt')
  async getPromptForN8n(
    @Param('fullInstanceName') fullInstanceName: string,
    @Headers('x-api-key') apiKey: string,
    @Res() res: Response,
  ) {
    const expectedApiKey = process.env.N8N_API_KEY;
    
    if (!expectedApiKey || apiKey !== expectedApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      const result = await this.service.getPromptByFullInstanceName(fullInstanceName);
      return res.json(result);
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ error: 'Instance not found', prompt: null });
      }
      throw error;
    }
  }

  @Get()
  async getInstances(@Request() req: any, @Res() res: Response) {
    try {
      const effectiveUserId = this.getEffectiveUserId(req);
      console.log('Fetching instances for effective user:', effectiveUserId, 'isSubUser:', this.isSubUser(req));
      
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      const url = `${baseUrl.replace(/\/$/, '')}/instance/fetchInstances`;

      const upstreamResponse = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': apiKey,
        },
      });

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: 'Failed to fetch instances',
        });
      }

      const data = await upstreamResponse.json();
      console.log('Raw instances from external API:', data);
      
      // Filter instances by effective user ID prefix and strip prefix from names
      let userInstances = data
        .filter((instance: any) => {
          const instanceName = instance.name || instance.instanceName;
          const hasPrefix = instanceName && instanceName.startsWith(`${effectiveUserId}_`);
          return hasPrefix;
        })
        .map((instance: any) => {
          const instanceName = instance.name || instance.instanceName;
          return {
            ...instance,
            name: this.service.stripUserPrefix(instanceName, effectiveUserId),
            instanceName: this.service.stripUserPrefix(instanceName, effectiveUserId),
          };
        });

      // If sub-user, filter to only permitted instances
      if (this.isSubUser(req)) {
        const permittedInstanceIds = await this.subUsersService.getPermittedInstanceIds(req.user.id);
        // Get instance names from DB for permitted IDs
        const permittedNames = new Set<string>();
        for (const inst of userInstances) {
          // Check if this instance (by name + owner) has a permission record
          const hasPermission = await this.subUsersService.hasPermissionForInstance(
            req.user.id,
            inst.name,
            effectiveUserId,
          );
          if (hasPermission) {
            permittedNames.add(inst.name);
          }
        }
        userInstances = userInstances.filter((inst: any) => permittedNames.has(inst.name));
      }

      console.log('Filtered user instances:', userInstances);
      return res.json(userInstances);
    } catch (error) {
      console.error('Error fetching instances:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }

  @Post('connect')
  @UseGuards(PremiumGuard)
  async connect(@Body() body: { instanceName: string }, @Res() res: Response, @Request() req: any) {
    try {
      // Sub-users cannot create instances
      if (this.isSubUser(req)) {
        return res.status(403).json({ error: 'Sub-usuários não podem criar instâncias.' });
      }

      const { instanceName } = body;
      
      if (!instanceName) {
        return res.status(400).json({ error: 'Instance name is required' });
      }

      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;
      const integration = process.env.WPP_INTEGRATION_TYPE;

      if (!baseUrl || !apiKey || !integration) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      const url = `${baseUrl.replace(/\/$/, '')}/instance/create`;
      
      // Prefix instance name with user ID
      const userId = req.user.id;
      const prefixedInstanceName = this.service.getPrefixedInstanceName(userId, instanceName);

      const upstreamResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
        },
        body: JSON.stringify({
          instanceName: prefixedInstanceName,
          integration,
          qrcode: true,
        }),
      });

      const data = await upstreamResponse.json().catch(() => ({}));

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: 'Failed to create instance',
          details: data
        });
      }

      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }

  @Get(':name/prompt')
  async getPrompt(@Param('name') name: string, @Request() req: any): Promise<{ prompt: string }> {
    await this.ensureSubUserPermission(req, name);
    const userId = this.getEffectiveUserId(req);
    const prompt = await this.service.getPromptByName(name, userId);
    return { prompt };
  }

  @Put(':name/prompt')
  async putPrompt(
    @Param('name') name: string,
    @Body() body: { prompt: string },
    @Res() res: Response,
    @Request() req: any,
  ) {
    await this.ensureSubUserPermission(req, name);
    const userId = this.getEffectiveUserId(req);
    const { instance, created } = await this.service.upsertPromptByName(
      name,
      body.prompt,
      userId,
    );
    return res
      .status(created ? 201 : 200)
      .json({ id: instance.id, name: instance.name, prompt: instance.prompt });
  }

  @Get(':name/state')
  async getInstanceState(@Param('name') name: string, @Request() req: any, @Res() res: Response) {
    try {
      await this.ensureSubUserPermission(req, name);
      const userId = this.getEffectiveUserId(req);
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      // Prefix instance name with effective user ID for external API call
      const prefixedInstanceName = this.service.getPrefixedInstanceName(userId, name);
      const url = `${baseUrl.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(prefixedInstanceName)}`;

      const upstreamResponse = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': apiKey,
        },
        cache: 'no-store',
      });

      const data = await upstreamResponse.json().catch(() => ({}));

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: 'Failed to fetch connection state',
          details: data
        });
      }

      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }

  @Get(':name/connect')
  async connectInstance(@Param('name') name: string, @Request() req: any, @Res() res: Response) {
    try {
      await this.ensureSubUserPermission(req, name);
      const userId = this.getEffectiveUserId(req);
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      // Prefix instance name with effective user ID for external API call
      const prefixedInstanceName = this.service.getPrefixedInstanceName(userId, name);
      const url = `${baseUrl.replace(/\/$/, '')}/instance/connect/${encodeURIComponent(prefixedInstanceName)}`;

      const upstreamResponse = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': apiKey,
        },
        cache: 'no-store',
      });

      const data = await upstreamResponse.json().catch(() => ({}));

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: 'Failed to initiate connection',
          details: data
        });
      }

      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }

  @Delete(':name')
  async deleteInstance(@Param('name') name: string, @Request() req: any, @Res() res: Response) {
    try {
      // Sub-users cannot delete instances
      if (this.isSubUser(req)) {
        return res.status(403).json({ error: 'Sub-usuários não podem excluir instâncias.' });
      }

      const userId = this.getEffectiveUserId(req);
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      // Prefix instance name with user ID for external API call
      const prefixedInstanceName = this.service.getPrefixedInstanceName(userId, name);
      const url = `${baseUrl.replace(/\/$/, '')}/instance/delete/${encodeURIComponent(prefixedInstanceName)}`;

      const upstreamResponse = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': apiKey,
        },
        cache: 'no-store',
      });

      const data = await upstreamResponse.json().catch(() => ({}));

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: 'Failed to delete instance',
          details: data
        });
      }

      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }

  @Post(':name/webhook')
  async configureWebhook(@Param('name') name: string, @Request() req: any, @Res() res: Response) {
    try {
      await this.ensureSubUserPermission(req, name);
      const userId = this.getEffectiveUserId(req);
      const baseUrl = process.env.WPP_API_BASE_URL;
      const apiKey = process.env.WPP_API_KEY;
      const webhookUrl = process.env.WPP_WEBHOOK_URL;

      if (!baseUrl || !apiKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
      }

      if (!webhookUrl) {
        return res.status(500).json({ error: 'Webhook URL not configured' });
      }

      // Prefix instance name with effective user ID for external API call
      const prefixedInstanceName = this.service.getPrefixedInstanceName(userId, name);
      const url = `${baseUrl.replace(/\/$/, '')}/webhook/set/${encodeURIComponent(prefixedInstanceName)}`;

      const webhookConfig = {
        webhook: {
          byEvents: false,
          base64: true,
          events: [
            "MESSAGES_UPSERT"
          ],
          enabled: true,
          url: webhookUrl
        }
      };

      const upstreamResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
        },
        body: JSON.stringify(webhookConfig),
      });

      const data = await upstreamResponse.json().catch(() => ({}));

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: 'Failed to configure webhook',
          details: data
        });
      }

      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  }
}


