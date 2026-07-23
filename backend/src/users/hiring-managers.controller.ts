import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HiringManagerOption, UsersService } from './users.service';

/**
 * Narrow, least-privilege read used to populate the job-posting
 * Hiring-Manager-assignment picker — separate from the full admin/users
 * roster (SUPER_ADMIN-only) since HR_ADMIN needs this specific list without
 * broader user-management access.
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN')
@Controller('users/hiring-managers')
export class HiringManagersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List active Hiring Managers, for assigning to a job posting.',
  })
  @ApiResponse({ status: 200 })
  async list(): Promise<HiringManagerOption[]> {
    return this.users.listHiringManagers();
  }
}
