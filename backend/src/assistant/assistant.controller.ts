import {
  BadRequestException,
  Body,
  Controller,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import {
  AssistantMessageInput,
  AssistantOrchestratorService,
  AssistantReply,
} from './assistant-orchestrator.service';
import { AssistantStreamEvent } from './assistant-stream-event';
import { AskAssistantDto } from './dto/ask-assistant.dto';
import { getToolProgressLabel } from './tool-definitions';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const optionalPdfValidationPipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^application\/pdf$/ })
  .addMaxSizeValidator({ maxSize: MAX_ATTACHMENT_BYTES })
  .build({
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
    fileIsRequired: false,
  });

@ApiTags('assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly orchestrator: AssistantOrchestratorService) {}

  @Post('message')
  @ApiOperation({
    summary:
      'Send a message to the recruitment assistant. Attach a CV (multipart `file`) when asking it to process one. ' +
      'Conversation history is stateless — resend prior turns as JSON in `history` each time.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          example:
            'Create a job posting for a Senior Backend Engineer in Lahore.',
        },
        history: {
          type: 'string',
          description:
            'JSON-encoded array of prior turns: [{ "role": "user"|"assistant", "content": "..." }]',
          example: '[]',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Optional CV attachment (PDF).',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Newline-delimited JSON stream: zero or more {"type":"tool",...} progress events (live status while a tool call is in flight) ' +
      'followed by exactly one {"type":"final",...AssistantReply} or {"type":"error",...} event.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  async message(
    @Body() body: AskAssistantDto,
    @UploadedFile(optionalPdfValidationPipe)
    file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    // parseHistory can still throw a normal BadRequestException here — this
    // runs before any header is written, so Nest's default exception filter
    // handles it as an ordinary JSON error response, not a broken stream.
    const history = parseHistory(body.history);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    const writeEvent = (event: AssistantStreamEvent) => {
      res.write(JSON.stringify(event) + '\n');
    };

    try {
      const reply = await this.orchestrator.handleMessage(
        history,
        body.message,
        user.id,
        user.role,
        file,
        (toolEvent) =>
          writeEvent({
            type: 'tool',
            tool: toolEvent.tool,
            phase: toolEvent.phase,
            label: getToolProgressLabel(toolEvent.tool),
          }),
      );
      writeEvent({ type: 'final', ...reply });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error.',
      });
    } finally {
      res.end();
    }
  }

  @Post('actions/:id/confirm')
  @ApiOperation({
    summary:
      'Confirm a pending sensitive action (publish a job posting, change its status). Executes directly — no LLM round-trip.',
  })
  @ApiResponse({ status: 200 })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssistantReply> {
    return this.orchestrator.confirmAction(id, user.id, user.role);
  }

  @Post('actions/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a pending sensitive action instead of confirming it.',
  })
  @ApiResponse({ status: 200 })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ cancelled: true }> {
    await this.orchestrator.cancelAction(id, user.id);
    return { cancelled: true };
  }
}

function parseHistory(raw: string | undefined): AssistantMessageInput[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('history must be a JSON-encoded array.');
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException('history must be a JSON-encoded array.');
  }
  return parsed.map((entry: unknown, index: number) => {
    const record = entry as Record<string, unknown>;
    if (
      (record.role !== 'user' && record.role !== 'assistant') ||
      typeof record.content !== 'string'
    ) {
      throw new BadRequestException(
        `history[${index}] must be { role: "user" | "assistant", content: string }.`,
      );
    }
    return { role: record.role, content: record.content };
  });
}
