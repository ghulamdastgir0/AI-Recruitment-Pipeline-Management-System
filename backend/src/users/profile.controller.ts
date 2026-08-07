import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

/**
 * Self-service profile management for any authenticated staff account (Super
 * Admin, HR Admin, or Hiring Manager) — view/edit their own name and change
 * their own password. Unlike UsersController (SUPER_ADMIN-only, manages
 * *other* users), this is intentionally open to every role since everyone
 * manages their own profile.
 */
@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "Get the current user's own profile." })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.getOwnProfile(user.id);
  }

  @Patch()
  @ApiOperation({ summary: "Update the current user's own name." })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async updateProfile(
    @Body() body: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.updateOwnProfile(user.id, body);
  }

  @Patch('password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  // Same tight limit as /auth/login (see AuthController) — verifying a
  // current password is just as brute-forceable as logging in.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Change the current user's own password." })
  @ApiResponse({ status: 200, description: 'Password changed.' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ message: string }> {
    await this.users.changeOwnPassword(user.id, body);
    return { message: 'Password changed.' };
  }
}
