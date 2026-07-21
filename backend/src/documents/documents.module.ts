import { Module } from '@nestjs/common';
import { DocumentsAdminController } from './documents-admin.controller';
import { DocumentProcessorService } from './services/document-processor.service';
import { DocumentRetrievalService } from './services/document-retrieval.service';
import { DocumentService } from './services/document.service';
import { FileStorageService } from './services/file-storage.service';
import { TextChunkerService } from './services/text-chunker.service';

@Module({
  controllers: [DocumentsAdminController],
  providers: [
    DocumentProcessorService,
    DocumentRetrievalService,
    DocumentService,
    FileStorageService,
    TextChunkerService,
  ],
  exports: [DocumentRetrievalService],
})
export class DocumentsModule {}
