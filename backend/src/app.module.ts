import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai-chatbot/ai.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AiModule],
})
export class AppModule {}
