import { Global, Module } from '@nestjs/common';
import { GeminiClientService } from './gemini-client.service';
import { LlmClientService } from './llm-client.service';

@Global()
@Module({
  providers: [LlmClientService, GeminiClientService],
  exports: [LlmClientService, GeminiClientService],
})
export class LlmClientModule {}
