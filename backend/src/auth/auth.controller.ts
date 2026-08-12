import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ACCESS_TOKEN_COOKIE, JwtPayload } from './types';

class LoginResponseDto {
  @ApiProperty() user!: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  // Cross-site (different registrable domain) in a real deployment needs
  // SameSite=None+Secure to be sent at all; same-site localhost dev (just a
  // different port) works fine with the more restrictive Lax and no HTTPS.
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as
    | 'none'
    | 'lax',
  path: '/',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  // Tight per-IP limit — login is the single most brute-forceable public
  // endpoint (unlike CV upload/interview turns, nothing here was throttled
  // at all before).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Authenticate. Sets the session as an httpOnly cookie (not returned ' +
      'in the body — inaccessible to page JS, so an XSS bug can\'t steal it).',
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(body.email, body.password);
    // exp comes from the token itself rather than re-deriving it from
    // JWT_EXPIRES_IN, so the cookie's lifetime can never drift out of sync
    // with the token it's carrying.
    const { exp } = this.jwt.decode(result.accessToken) as JwtPayload & {
      exp: number;
    };
    res.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, {
      ...COOKIE_OPTIONS,
      expires: new Date(exp * 1000),
    });
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Clear the session cookie. Always succeeds, even with no/an already-invalid session.',
  })
  @ApiResponse({ status: 200, description: 'Logged out.' })
  logout(@Res({ passthrough: true }) res: Response): { message: string } {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: COOKIE_OPTIONS.path });
    return { message: 'Logged out.' };
  }
}
