import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.services';
import { KnowledgeBaseService } from './knowledge-base.service';

class AskQueryDto {
  @ApiProperty({ example: 'What is the parental leave policy?' })
  query!: string;
}

class AskQueryResponseDto {
  @ApiProperty()
  answer!: string;
}

class SeedKnowledgeBaseResponseDto {
  @ApiProperty()
  inserted!: number;
}

@ApiTags('ai-chatbot')
@Controller('ai-chatbot')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  @Post('query')
  @ApiOperation({ summary: 'Ask the HR Assistant a question, answered using pgvector-retrieved company policy context' })
  @ApiResponse({ status: 200, description: 'Answer generated successfully.', type: AskQueryResponseDto })
  @ApiResponse({ status: 400, description: 'query must be a non-empty string.' })
  async query(@Body() body: AskQueryDto): Promise<AskQueryResponseDto> {
    if (!body?.query || !body.query.trim()) {
      throw new BadRequestException('query must be a non-empty string.');
    }

    const answer = await this.aiService.ask(body.query);
    return { answer };
  }

  @Post('seed-knowledge-base')
  @ApiOperation({
    summary: 'Re-embed and reload the Nexora company documents into KnowledgeDocument (internal/ops use only)',
  })
  @ApiResponse({ status: 200, description: 'Knowledge base re-seeded.', type: SeedKnowledgeBaseResponseDto })
  async seedKnowledgeBase(): Promise<SeedKnowledgeBaseResponseDto> {
    return this.knowledgeBase.seed();
  }
}
