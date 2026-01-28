import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instance } from './instance.entity';
import { ExamplePromptsService } from '../example-prompts/example-prompts.service';

@Injectable()
export class InstancesService {
  constructor(
    @InjectRepository(Instance)
    private readonly repo: Repository<Instance>,
    private readonly examplePromptsService: ExamplePromptsService,
  ) {}

  async getPromptByName(name: string, userId: string): Promise<string> {
    const inst = await this.repo.findOne({ where: { name, userId } });
    if (!inst) {
      // Auto-create instance with first default e-commerce prompt
      const examplePrompts = await this.examplePromptsService.getAllExamplePrompts();
      const defaultPrompt = examplePrompts.length > 0 ? examplePrompts[0].prompt : '';
      
      const newInstance = this.repo.create({ name, userId, prompt: defaultPrompt });
      await this.repo.save(newInstance);
      
      return defaultPrompt;
    }
    return inst.prompt;
  }

  /**
   * Gets prompt by full instance name (with user prefix)
   * Used by n8n to fetch prompts without knowing userId separately
   */
  async getPromptByFullInstanceName(fullInstanceName: string): Promise<{ prompt: string; instanceName: string; userId: string }> {
    // Full instance name format: userId_instanceName
    const separatorIndex = fullInstanceName.indexOf('_');
    
    if (separatorIndex === -1) {
      throw new NotFoundException('Invalid instance name format');
    }

    const userId = fullInstanceName.substring(0, separatorIndex);
    const name = fullInstanceName.substring(separatorIndex + 1);

    let inst = await this.repo.findOne({ where: { name, userId } });
    
    if (!inst) {
      // Auto-create instance with first default e-commerce prompt
      const examplePrompts = await this.examplePromptsService.getAllExamplePrompts();
      const defaultPrompt = examplePrompts.length > 0 ? examplePrompts[0].prompt : '';
      
      const newInstance = this.repo.create({ name, userId, prompt: defaultPrompt });
      inst = await this.repo.save(newInstance);
    }

    return {
      prompt: inst.prompt,
      instanceName: name,
      userId: userId,
    };
  }

  async upsertPromptByName(
    name: string,
    prompt: string,
    userId: string,
  ): Promise<{ instance: Instance; created: boolean }> {
    const existing = await this.repo.findOne({ where: { name, userId } });
    if (existing) {
      existing.prompt = prompt;
      const saved = await this.repo.save(existing);
      return { instance: saved, created: false };
    }
    const created = this.repo.create({ name, prompt, userId });
    const saved = await this.repo.save(created);
    return { instance: saved, created: true };
  }

  /**
   * Constructs a prefixed instance name for external API calls
   */
  getPrefixedInstanceName(userId: string, userProvidedName: string): string {
    return `${userId}_${userProvidedName}`;
  }

  /**
   * Strips the user ID prefix from instance names for display
   */
  stripUserPrefix(instanceName: string, userId: string): string {
    const prefix = `${userId}_`;
    if (instanceName.startsWith(prefix)) {
      return instanceName.substring(prefix.length);
    }
    return instanceName;
  }
}


