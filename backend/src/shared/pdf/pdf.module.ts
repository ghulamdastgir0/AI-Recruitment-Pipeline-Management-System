import { Global, Module } from '@nestjs/common';
import { PdfTextExtractorService } from './pdf-text-extractor.service';

@Global()
@Module({
  providers: [PdfTextExtractorService],
  exports: [PdfTextExtractorService],
})
export class PdfModule {}
