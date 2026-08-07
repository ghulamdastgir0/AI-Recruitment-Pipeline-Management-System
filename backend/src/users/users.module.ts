import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { HiringManagersController } from './hiring-managers.controller';
import { ProfileController } from './profile.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    // Local (not global) throttler config for PATCH /profile/password — same
    // pattern as AuthModule/CandidatesModule/InterviewsModule.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [UsersController, HiringManagersController, ProfileController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
