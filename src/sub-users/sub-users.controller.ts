import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Param,
  Body,
  Request,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { SubUsersService } from './sub-users.service';
import { PremiumGuard } from '../auth/premium.guard';

@Controller('sub-users')
export class SubUsersController {
  constructor(private readonly subUsersService: SubUsersService) {}

  /**
   * Ensure the requesting user is a premium parent (not a sub-user)
   */
  private ensureParentUser(req: any): string {
    if (req.user.parentUserId) {
      throw new ForbiddenException('Sub-usuários não podem gerenciar outros sub-usuários.');
    }
    return req.user.id;
  }

  @Get()
  @UseGuards(PremiumGuard)
  async getSubUsers(@Request() req: any) {
    const parentUserId = this.ensureParentUser(req);
    return this.subUsersService.getSubUsers(parentUserId);
  }

  /**
   * Get parent user's instances (for the permission selection UI)
   * IMPORTANT: This static route must be defined BEFORE :id parameterized routes
   */
  @Get('instances')
  @UseGuards(PremiumGuard)
  async getParentInstances(@Request() req: any) {
    const parentUserId = this.ensureParentUser(req);
    return this.subUsersService.getParentInstances(parentUserId);
  }

  @Post()
  @UseGuards(PremiumGuard)
  async createSubUser(
    @Request() req: any,
    @Body() body: { email: string; name: string; password: string },
  ) {
    const parentUserId = this.ensureParentUser(req);
    return this.subUsersService.createSubUser(parentUserId, body);
  }

  @Delete(':id')
  @UseGuards(PremiumGuard)
  async deleteSubUser(@Request() req: any, @Param('id') id: string) {
    const parentUserId = this.ensureParentUser(req);
    await this.subUsersService.deleteSubUser(parentUserId, id);
    return { message: 'Sub-usuário excluído com sucesso.' };
  }

  @Get(':id/permissions')
  @UseGuards(PremiumGuard)
  async getPermissions(@Request() req: any, @Param('id') id: string) {
    const parentUserId = this.ensureParentUser(req);
    return this.subUsersService.getPermissions(parentUserId, id);
  }

  @Put(':id/permissions')
  @UseGuards(PremiumGuard)
  async updatePermissions(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { instanceIds: string[] },
  ) {
    const parentUserId = this.ensureParentUser(req);
    return this.subUsersService.updatePermissions(parentUserId, id, body.instanceIds);
  }
}
