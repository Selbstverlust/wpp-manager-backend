import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../users/user.entity';
import { SubUserPermission } from './sub-user-permission.entity';
import { Instance } from '../instances/instance.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SubUsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(SubUserPermission)
    private readonly permissionRepository: Repository<SubUserPermission>,
    @InjectRepository(Instance)
    private readonly instanceRepository: Repository<Instance>,
  ) {}

  /**
   * List all sub-users belonging to a parent user
   */
  async getSubUsers(parentUserId: string): Promise<any[]> {
    const subUsers = await this.userRepository.find({
      where: { parentUserId },
      order: { createdAt: 'DESC' },
    });

    // For each sub-user, count their permissions
    const result = await Promise.all(
      subUsers.map(async (subUser) => {
        const permissionCount = await this.permissionRepository.count({
          where: { subUserId: subUser.id },
        });
        return {
          id: subUser.id,
          email: subUser.email,
          name: subUser.name,
          createdAt: subUser.createdAt,
          permissionCount,
        };
      }),
    );

    return result;
  }

  /**
   * Create a new sub-user under a parent user
   */
  async createSubUser(
    parentUserId: string,
    dto: { email: string; name: string; password: string },
  ): Promise<any> {
    // Check if email is already in use
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Um usuário com este email já existe.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const subUser = this.userRepository.create({
      email: dto.email,
      name: dto.name,
      password: hashedPassword,
      role: 'sub_user',
      parentUserId,
    });

    const saved = await this.userRepository.save(subUser);

    return {
      id: saved.id,
      email: saved.email,
      name: saved.name,
      createdAt: saved.createdAt,
      permissionCount: 0,
    };
  }

  /**
   * Delete a sub-user (must belong to parent)
   */
  async deleteSubUser(parentUserId: string, subUserId: string): Promise<void> {
    const subUser = await this.userRepository.findOne({
      where: { id: subUserId, parentUserId },
    });
    if (!subUser) {
      throw new NotFoundException('Sub-usuário não encontrado.');
    }

    await this.userRepository.remove(subUser);
  }

  /**
   * Get permissions for a specific sub-user
   */
  async getPermissions(parentUserId: string, subUserId: string): Promise<any[]> {
    // Verify sub-user belongs to parent
    const subUser = await this.userRepository.findOne({
      where: { id: subUserId, parentUserId },
    });
    if (!subUser) {
      throw new NotFoundException('Sub-usuário não encontrado.');
    }

    const permissions = await this.permissionRepository.find({
      where: { subUserId },
      relations: ['instance'],
    });

    return permissions.map((p) => ({
      instanceId: p.instanceId,
      instanceName: p.instance?.name || null,
    }));
  }

  /**
   * Update permissions for a sub-user (replace all permissions)
   */
  async updatePermissions(
    parentUserId: string,
    subUserId: string,
    instanceIds: string[],
  ): Promise<any[]> {
    // Verify sub-user belongs to parent
    const subUser = await this.userRepository.findOne({
      where: { id: subUserId, parentUserId },
    });
    if (!subUser) {
      throw new NotFoundException('Sub-usuário não encontrado.');
    }

    // Verify all instances belong to the parent user
    if (instanceIds.length > 0) {
      const instances = await this.instanceRepository.find({
        where: { id: In(instanceIds), userId: parentUserId },
      });
      if (instances.length !== instanceIds.length) {
        throw new ForbiddenException(
          'Algumas instâncias não pertencem a você.',
        );
      }
    }

    // Remove existing permissions
    await this.permissionRepository.delete({ subUserId });

    // Create new permissions
    if (instanceIds.length > 0) {
      const newPermissions = instanceIds.map((instanceId) =>
        this.permissionRepository.create({ subUserId, instanceId }),
      );
      await this.permissionRepository.save(newPermissions);
    }

    // Return updated permissions
    return this.getPermissions(parentUserId, subUserId);
  }

  /**
   * Get instance IDs that a sub-user has permission to access
   */
  async getPermittedInstanceIds(subUserId: string): Promise<string[]> {
    const permissions = await this.permissionRepository.find({
      where: { subUserId },
    });
    return permissions.map((p) => p.instanceId);
  }

  /**
   * Check if a sub-user has permission for a specific instance (by name and owner userId)
   */
  async hasPermissionForInstance(
    subUserId: string,
    instanceName: string,
    ownerUserId: string,
  ): Promise<boolean> {
    const instance = await this.instanceRepository.findOne({
      where: { name: instanceName, userId: ownerUserId },
    });
    if (!instance) {
      // If instance doesn't exist in DB yet, allow access (it might be created on-the-fly)
      return true;
    }
    const permission = await this.permissionRepository.findOne({
      where: { subUserId, instanceId: instance.id },
    });
    return !!permission;
  }

  /**
   * Get the list of instances belonging to the parent user (for the permissions UI)
   */
  async getParentInstances(parentUserId: string): Promise<any[]> {
    const instances = await this.instanceRepository.find({
      where: { userId: parentUserId },
      order: { createdAt: 'DESC' },
    });
    return instances.map((i) => ({
      id: i.id,
      name: i.name,
    }));
  }
}
