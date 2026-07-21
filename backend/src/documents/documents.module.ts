import { Module } from '@nestjs/common';
import { DocumentsAdminController } from './documents-admin.controller';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';
import { BackgroundJobQueueService } from './services/background-job-queue.service';
import { DocumentProcessorService } from './services/document-processor.service';
import { DocumentRetrievalService } from './services/document-retrieval.service';
import { DocumentService } from './services/document.service';
import { FileStorageService } from './services/file-storage.service';
import { PdfTextExtractorService } from './services/pdf-text-extractor.service';
import { TextChunkerService } from './services/text-chunker.service';

@Module({
  controllers: [DocumentsAdminController],
  providers: [
    AdminApiKeyGuard,
    BackgroundJobQueueService,
    DocumentProcessorService,
    DocumentRetrievalService,
    DocumentService,
    FileStorageService,
    PdfTextExtractorService,
    TextChunkerService,
  ],
  exports: [DocumentRetrievalService],
})
export class DocumentsModule {}
