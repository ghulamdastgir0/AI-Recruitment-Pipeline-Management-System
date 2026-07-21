import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { AiService, Citation } from './ai.services';

class AskQueryDto {
  @ApiProperty({ example: 'What is the parental leave policy?' })
  @IsString()
  @IsNotEmpty()
  query!: string;
}

class CitationDto implements Citation {
  @ApiProperty() documentId!: string;
  @ApiProperty() documentName!: string;
  @ApiProperty() version!: number;
  @ApiProperty() pageNumber!: number;
  @ApiProperty({ example: 'Company Handbook, version 2, page 14' })
  citation!: string;
}

class AskQueryResponseDto {
  @ApiProperty()
  answer!: string;

  @ApiProperty({ type: [CitationDto] })
  citations!: CitationDto[];
}

@ApiTags('ai-chatbot')
@Controller('ai-chatbot')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('query')
  @ApiOperation({
    summary:
      'Ask the HR Assistant a question. Restricted to HR policy questions (answered via pgvector retrieval over active ' +
      'policy documents) and job-posting creation; unrelated questions get a fixed refusal message.',
  })
  @ApiResponse({
    status: 200,
    description: 'Answer generated successfully.',
    type: AskQueryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'query must be a non-empty string.',
  })
  async query(@Body() body: AskQueryDto): Promise<AskQueryResponseDto> {
    if (!body?.query || !body.query.trim()) {
      throw new BadRequestException('query must be a non-empty string.');
    }

    return this.aiService.ask(body.query);
  }
}
