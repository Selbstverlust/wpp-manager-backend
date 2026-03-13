import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * Returns the effective userId, using the parent's id for sub-users.
   */
  private getEffectiveUserId(req: any): string {
    return req.user.parentUserId || req.user.id;
  }

  // ---- Categories CRUD ----

  @Get()
  async findAll(@Request() req: any) {
    const userId = this.getEffectiveUserId(req);
    return this.categoriesService.findAll(userId);
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() body: { name: string; color?: string },
  ) {
    const userId = this.getEffectiveUserId(req);
    return this.categoriesService.create(userId, body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { name?: string; color?: string; position?: number },
  ) {
    const userId = this.getEffectiveUserId(req);
    return this.categoriesService.update(id, userId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Request() req: any) {
    const userId = this.getEffectiveUserId(req);
    await this.categoriesService.delete(id, userId);
  }

  // ---- Assignments ----

  @Get('assignments')
  async getAssignments(@Request() req: any) {
    const userId = this.getEffectiveUserId(req);
    return this.categoriesService.getAssignments(userId);
  }

  @Post(':id/assign')
  async assignChat(
    @Param('id') categoryId: string,
    @Request() req: any,
    @Body() body: { remoteJid: string; instanceName: string },
  ) {
    const userId = this.getEffectiveUserId(req);
    return this.categoriesService.assignChat(userId, {
      categoryId,
      remoteJid: body.remoteJid,
      instanceName: body.instanceName,
    });
  }

  @Delete(':id/assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassignChat(
    @Param('id') categoryId: string,
    @Request() req: any,
    @Body() body: { remoteJid: string; instanceName: string },
  ) {
    const userId = this.getEffectiveUserId(req);
    await this.categoriesService.unassignChat(userId, {
      remoteJid: body.remoteJid,
      instanceName: body.instanceName,
    });
  }
}
