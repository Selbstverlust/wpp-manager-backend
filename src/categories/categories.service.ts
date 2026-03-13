import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import { ChatCategoryAssignment } from './chat-category-assignment.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(ChatCategoryAssignment)
    private readonly assignmentRepo: Repository<ChatCategoryAssignment>,
  ) {}

  // ---- Categories CRUD ----

  async findAll(userId: string): Promise<Category[]> {
    return this.categoryRepo.find({
      where: { userId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(userId: string, dto: { name: string; color?: string }): Promise<Category> {
    // Auto-assign position: max existing position + 1
    const maxResult = await this.categoryRepo
      .createQueryBuilder('c')
      .select('COALESCE(MAX(c.position), -1)', 'maxPos')
      .where('c.user_id = :userId', { userId })
      .getRawOne();
    const nextPosition = (maxResult?.maxPos ?? -1) + 1;

    const category = this.categoryRepo.create({
      name: dto.name,
      color: dto.color || null,
      position: nextPosition,
      userId,
    });
    return this.categoryRepo.save(category);
  }

  async update(
    id: string,
    userId: string,
    dto: { name?: string; color?: string; position?: number },
  ): Promise<Category> {
    const category = await this.categoryRepo.findOne({ where: { id, userId } });
    if (!category) throw new NotFoundException('Categoria não encontrada');

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.color !== undefined) category.color = dto.color;
    if (dto.position !== undefined) category.position = dto.position;

    return this.categoryRepo.save(category);
  }

  async delete(id: string, userId: string): Promise<void> {
    const category = await this.categoryRepo.findOne({ where: { id, userId } });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    await this.categoryRepo.remove(category);
  }

  // ---- Assignments ----

  async getAssignments(userId: string): Promise<ChatCategoryAssignment[]> {
    return this.assignmentRepo.find({ where: { userId } });
  }

  async assignChat(
    userId: string,
    dto: { categoryId: string; remoteJid: string; instanceName: string },
  ): Promise<ChatCategoryAssignment> {
    // Verify the category belongs to the user
    const category = await this.categoryRepo.findOne({
      where: { id: dto.categoryId, userId },
    });
    if (!category) throw new NotFoundException('Categoria não encontrada');

    // Remove any existing assignment for this chat (a chat can only be in one category)
    await this.assignmentRepo.delete({
      remoteJid: dto.remoteJid,
      instanceName: dto.instanceName,
      userId,
    });

    const assignment = this.assignmentRepo.create({
      categoryId: dto.categoryId,
      remoteJid: dto.remoteJid,
      instanceName: dto.instanceName,
      userId,
    });
    return this.assignmentRepo.save(assignment);
  }

  async unassignChat(
    userId: string,
    dto: { remoteJid: string; instanceName: string },
  ): Promise<void> {
    await this.assignmentRepo.delete({
      remoteJid: dto.remoteJid,
      instanceName: dto.instanceName,
      userId,
    });
  }
}
