import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamplePrompt } from './example-prompt.entity';
import { ExamplePromptsService } from './example-prompts.service';
import { ExamplePromptsController } from './example-prompts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExamplePrompt])],
  providers: [ExamplePromptsService],
  controllers: [ExamplePromptsController],
  exports: [ExamplePromptsService],
})
export class ExamplePromptsModule {}
