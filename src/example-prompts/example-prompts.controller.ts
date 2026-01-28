import { Body, Controller, Get, Post } from '@nestjs/common';
import { ExamplePromptsService } from './example-prompts.service';
import { ExamplePrompt } from './example-prompt.entity';
import { Public } from '../auth/public.decorator';

@Controller('example-prompts')
export class ExamplePromptsController {
  constructor(private readonly service: ExamplePromptsService) {}

  @Post()
  async insertExamplePrompt(
    @Body() body: { name: string; prompt: string },
  ): Promise<ExamplePrompt> {
    return await this.service.insertExamplePrompt(body.name, body.prompt);
  }

  @Public()
  @Get()
  async getAllExamplePrompts(): Promise<ExamplePrompt[]> {
    return await this.service.getAllExamplePrompts();
  }
}
