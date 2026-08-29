import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/** SUPER_ADMIN is intentionally excluded — creating another Super Admin isn't a granted permission; only the seed script bootstraps that role. */
export const ASSIGNABLE_ROLES = ['HR_ADMIN', 'HIRING_MANAGER'] as const;

export class CreateUserDto {
  @ApiProperty({ example: 'hr.admin@nexorasystems.example' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'a-strong-temporary-password' })
  @IsString()
  @MinLength(8)
  // bcrypt silently ignores bytes past 72 — reject rather than hash a
  // password whose tail never matters.
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  lastName!: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES)
  role!: (typeof ASSIGNABLE_ROLES)[number];
}
