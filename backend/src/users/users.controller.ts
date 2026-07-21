import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateUserDto } from './dto/create-user.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

/** Super-Admin-only user management: add/invite, edit, deactivate/reactivate, and remove HR Admins and Hiring Managers. */
@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Add/invite a new HR Admin or Hiring Manager. Credentials must be communicated out of band (no email delivery in this system).',
  })
  @ApiResponse({ status: 201, type: UserResponseDto })
  async create(
    @Body() body: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.create(body, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all users.' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async list(): Promise<UserResponseDto[]> {
    return this.users.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user.' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.getById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit an HR Admin or Hiring Manager (name, or reassign their role).',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.update(id, body, user.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Deactivate or reactivate a user.' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async setStatus(
    @Param('id') id: string,
    @Body() body: SetUserStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.setStatus(id, body.isActive, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Remove a user. Implemented as deactivation (see UsersService.remove) — a hard delete would orphan job postings/audit history this user created.',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.remove(id, user.id);
  }
}
