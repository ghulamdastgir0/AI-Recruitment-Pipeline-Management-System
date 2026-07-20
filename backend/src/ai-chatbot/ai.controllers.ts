import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.services';

class AskQueryDto {
  @ApiProperty({ example: 'What skills are required for a backend engineer role?' })
  query!: string;
}

class AskQueryResponseDto {
  @ApiProperty()
  answer!: string;
}

@ApiTags('ai-chatbot')
@Controller('ai-chatbot')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('query')
  @ApiOperation({ summary: 'Ask the AI chatbot a question' })
  @ApiResponse({ status: 200, description: 'Answer generated successfully.', type: AskQueryResponseDto })
  @ApiResponse({ status: 400, description: 'query must be a non-empty string.' })
  async query(@Body() body: AskQueryDto): Promise<AskQueryResponseDto> {
    if (!body?.query || !body.query.trim()) {
      throw new BadRequestException('query must be a non-empty string.');
    }

    const answer = await this.aiService.ask(body.query);
    return { answer };
  }
}
