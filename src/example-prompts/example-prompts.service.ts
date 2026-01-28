import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExamplePrompt } from './example-prompt.entity';

@Injectable()
export class ExamplePromptsService implements OnModuleInit {
  constructor(
    @InjectRepository(ExamplePrompt)
    private readonly repo: Repository<ExamplePrompt>,
  ) {}

  async onModuleInit() {
    // Seed example prompts from environment variables if table is empty
    const count = await this.repo.count();
    if (count === 0) {
      await this.seedExamplePrompts();
    }
  }

  private async seedExamplePrompts() {
    const examplePrompts = [];

    for (let i = 1; i <= 5; i++) {
      const name = process.env[`EXAMPLE_PROMPT_${i}_NAME`];
      const prompt = process.env[`EXAMPLE_PROMPT_${i}_PROMPT`];

      if (name && prompt) {
        examplePrompts.push({ name, prompt });
      }
    }

    if (examplePrompts.length > 0) {
      await this.repo.save(examplePrompts);
    }
  }

  async insertExamplePrompt(name: string, prompt: string): Promise<ExamplePrompt> {
    const examplePrompt = this.repo.create({ name, prompt });
    return await this.repo.save(examplePrompt);
  }

  async getAllExamplePrompts(): Promise<ExamplePrompt[]> {
    // Ensure table exists and is populated with example data
    await this.ensureTableExistsAndPopulated();
    return await this.repo.find();
  }

  private async ensureTableExistsAndPopulated() {
    try {
      // Check if table exists by trying to count records
      const count = await this.repo.count();
      
      // If table is empty, populate it with example prompts from env
      if (count === 0) {
        await this.seedExamplePrompts();
      }
    } catch (error) {
      // If table doesn't exist, TypeORM will create it automatically due to synchronize: true
      // Then populate it with example prompts
      await this.seedExamplePrompts();
    }
  }
}
