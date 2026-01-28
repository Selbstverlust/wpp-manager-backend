import { Body, Controller, Get, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Post()
  async create(
    @Body() body: { email: string; name: string },
  ): Promise<User> {
    return this.usersService.create(body);
  }
}


