import { Module } from '@nestjs/common';
import { AudioStorageService } from './audio-storage.service';
import { GroqAudioService } from './groq-audio.service';

@Module({
  providers: [GroqAudioService, AudioStorageService],
  exports: [GroqAudioService, AudioStorageService],
})
export class AudioModule {}
