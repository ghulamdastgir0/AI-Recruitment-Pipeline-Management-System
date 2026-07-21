import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Authenticate and receive a JWT bearer token.' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  async login(@Body() body: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(body.email, body.password);
  }
}
