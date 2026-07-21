import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai-chatbot/ai.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmbeddingsModule } from './shared/embeddings/embeddings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmbeddingsModule,
    AiModule,
  ],
})
export class AppModule {}
