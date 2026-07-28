import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  StreamableFile,
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
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import { DocumentResponseDto } from './dto/document-response.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentService } from './services/document.service';
import { FileStorageService } from './services/file-storage.service';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

const pdfFileValidationPipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^application\/pdf$/ })
  .addMaxSizeValidator({ maxSize: MAX_PDF_BYTES })
  .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

function toResponseDto(document: {
  id: string;
  name: string;
  originalFileName: string;
  version: number;
  status: string;
  processingError: string | null;
  uploadedAt: Date;
  updatedAt: Date;
}): DocumentResponseDto {
  return {
    id: document.id,
    name: document.name,
    originalFileName: document.originalFileName,
    version: document.version,
    status: document.status,
    processingError: document.processingError,
    uploadedAt: document.uploadedAt,
    updatedAt: document.updatedAt,
  };
}

@ApiTags('admin-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/documents')
export class DocumentsAdminController {
  constructor(
    private readonly documents: DocumentService,
    private readonly storage: FileStorageService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Upload the first version of a new HR policy PDF. Extraction/embedding runs in the background.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'file'],
      properties: {
        name: {
          type: 'string',
          description:
            'Stable display name grouping every version of this document.',
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: DocumentResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PDF_BYTES },
    }),
  )
  async upload(
    @Body() body: UploadDocumentDto,
    @UploadedFile(pdfFileValidationPipe) file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DocumentResponseDto> {
    const document = await this.documents.uploadNewDocument(
      body.name,
      file,
      user.id,
    );
    return toResponseDto(document);
  }

  @Get()
  @ApiOperation({
    summary:
      'List documents and their versions, optionally filtered by name or status.',
  })
  @ApiResponse({ status: 200, type: [DocumentResponseDto] })
  async list(
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentResponseDto[]> {
    const documents = await this.documents.list({
      name: query.name,
      status: query.status,
    });
    return documents.map(toResponseDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single document version.' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  async getOne(@Param('id') id: string): Promise<DocumentResponseDto> {
    const document = await this.documents.getById(id);
    return toResponseDto(document);
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Download the original PDF for a document version.',
  })
  async downloadFile(@Param('id') id: string): Promise<StreamableFile> {
    const document = await this.documents.getById(id);
    const buffer = await this.storage.read(document.filePath);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${document.originalFileName}"`,
    });
  }

  @Post(':id/versions')
  @ApiOperation({
    summary:
      'Upload a newer version of an existing document (id of any prior version of the same document). ' +
      'The new version is processed and, once fully embedded, becomes ACTIVE while the previous ACTIVE version is marked INACTIVE.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: DocumentResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PDF_BYTES },
    }),
  )
  async uploadNewVersion(
    @Param('id') id: string,
    @UploadedFile(pdfFileValidationPipe) file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DocumentResponseDto> {
    const document = await this.documents.uploadNewVersion(id, file, user.id);
    return toResponseDto(document);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary:
      'Manually activate or deactivate a document version. Activating a version retires any other ACTIVE version of the same name.',
  })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  async setStatus(
    @Param('id') id: string,
    @Body() body: UpdateDocumentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DocumentResponseDto> {
    const document = await this.documents.setStatus(id, body.status, user.id);
    return toResponseDto(document);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Permanently delete a document version and its embedded chunks. The ACTIVE version must be deactivated first.',
  })
  @ApiResponse({ status: 204 })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.documents.delete(id, user.id);
  }
}
