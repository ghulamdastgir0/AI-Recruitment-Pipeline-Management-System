import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JobAssignmentGuard } from './guards/job-assignment.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Global()
@Module({
  imports: [
    // Local (not global) throttler config for /auth/login — same pattern as
    // CandidatesModule/InterviewsModule. Previously the single most
    // brute-forceable public endpoint in the codebase had no throttle at all.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // @nestjs/jwt's expiresIn type only accepts a narrow "StringValue"
        // literal union at compile time; the actual runtime value always
        // comes from JWT_EXPIRES_IN as a plain string (e.g. "8h").
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '8h') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, JobAssignmentGuard],
  exports: [
    JwtModule,
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    JobAssignmentGuard,
  ],
})
export class AuthModule {}
