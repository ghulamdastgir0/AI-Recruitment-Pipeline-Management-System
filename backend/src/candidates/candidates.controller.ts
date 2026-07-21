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
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UploadCvDto } from './dto/upload-cv.dto';
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

@ApiTags('candidates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly cvUpload: CvUploadService) {}

  @Post('upload')
  @ApiOperation({
    summary:
      'Upload a candidate CV against a job posting. Processing (extract/parse/embed) runs in the background.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CV_BYTES },
    }),
  )
  async upload(
    @Body() body: UploadCvDto,
    @UploadedFile(pdfFileValidationPipe) file: Express.Multer.File,
  ): Promise<UploadCvResult> {
    return this.cvUpload.uploadCv(body.jobPostingId, file);
  }

  @Get(':id/status')
  @ApiOperation({
    summary: 'Check CV processing status (PROCESSING | READY | FAILED).',
  })
  @ApiResponse({ status: 200 })
  async getStatus(@Param('id') id: string): Promise<CandidateProcessingStatus> {
    return this.cvUpload.getStatus(id);
  }
}
