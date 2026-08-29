import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, type UserSummary } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { clearSessionCookie, setSessionCookie } from './session-cookie';
import { ACCESS_TOKEN_COOKIE } from './types';

class LoginResponseDto {
  @ApiProperty() user!: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

function readToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
  const authHeader = req.header('authorization');
  const headerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : undefined;
  return cookieToken ?? headerToken;
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
  @ApiOperation({
    summary:
      'Authenticate. Sets the session as an httpOnly cookie (not returned ' +
      "in the body — inaccessible to page JS, so an XSS bug can't steal it).",
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(body.email, body.password);
    setSessionCookie(res, result.accessToken, result.expiresAt);
    return { user: result.user };
  }

  @Get('session')
  @ApiOperation({
    summary:
      'Current session, or { user: null } when unauthenticated. Always 200 ' +
      '— lets the frontend check login state on load without a 401.',
  })
  async session(@Req() req: Request): Promise<{ user: UserSummary | null }> {
    const user = await this.auth.sessionFromToken(readToken(req));
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'End the session. Clears the cookie AND revokes the token server-side ' +
      '(so it stops working everywhere, not just in this browser). Always ' +
      'succeeds, even with no/an already-invalid session.',
  })
  @ApiResponse({ status: 200, description: 'Logged out.' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.auth.revokeSessionForToken(readToken(req));
    clearSessionCookie(res);
    return { message: 'Logged out.' };
  }
}
