import { Module } from '@nestjs/common';
import { HiringManagersController } from './hiring-managers.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, HiringManagersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
