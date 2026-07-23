import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { PublicUploadCvDto } from './dto/public-upload-cv.dto';
import {
  CandidateProcessingStatus,
  CvUploadService,
  UploadCvResult,
} from './services/cv-upload.service';

const MAX_CV_BYTES = 10 * 1024 * 1024;

const pdfFileValidationPipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^application\/pdf$/ })
  .addMaxSizeValidator({ maxSize: MAX_CV_BYTES })
  .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Public candidate self-apply surface — no authentication, by design. HR/
 * Admin never use this controller; staff CV upload and status checks go
 * through the AI assistant's uploadCandidateCv/getCandidateProcessingStatus
 * tools instead (see assistant/tool-registry.service.ts), which are
 * JWT-guarded and audit-logged. Keeping the two paths separate (rather than
 * one dual-mode endpoint) is what actually avoids duplication here — this
 * controller only ever needs to know about SELF_APPLIED candidates.
 */
@ApiTags('candidates')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly cvUpload: CvUploadService) {}

  @Post('upload')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Apply to a job posting with your CV. No authentication required. ' +
      'Only accepted for currently PUBLISHED postings.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'jobPostingId',
        'candidateName',
        'candidateEmail',
        'candidatePhone',
        'file',
      ],
      properties: {
        jobPostingId: {
          type: 'string',
          description: 'Id of the job posting this CV is being submitted for.',
        },
        candidateName: { type: 'string' },
        candidateEmail: { type: 'string' },
        candidatePhone: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CV_BYTES },
    }),
  )
  async upload(
    @Body() body: PublicUploadCvDto,
    @UploadedFile(pdfFileValidationPipe) file: Express.Multer.File,
  ): Promise<UploadCvResult> {
    return this.cvUpload.uploadCv(
      body.jobPostingId,
      file,
      'SELF_APPLIED',
      undefined,
      {
        name: body.candidateName,
        email: body.candidateEmail,
        phone: body.candidatePhone,
      },
    );
  }

  @Get(':id/status')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Check your application status with the reference id (candidateProfileId) returned from upload. ' +
      'No authentication required. Never exposes your match score — scores are for HR/Hiring Manager review only.',
  })
  @ApiResponse({ status: 200 })
  async getStatus(@Param('id') id: string): Promise<CandidateProcessingStatus> {
    return this.cvUpload.getStatus(id);
  }
}
