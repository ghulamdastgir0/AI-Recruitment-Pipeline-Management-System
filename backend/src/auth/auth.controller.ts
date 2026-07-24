import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

class LoginResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() user!: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  // Tight per-IP limit — login is the single most brute-forceable public
  // endpoint (unlike CV upload/interview turns, nothing here was throttled
  // at all before).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate and receive a JWT bearer token.' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  async login(@Body() body: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(body.email, body.password);
  }
}
