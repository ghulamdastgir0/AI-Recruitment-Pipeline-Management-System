import type { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_COOKIE } from './types';

/**
 * Shared session-cookie handling for the two endpoints that mint a token
 * (POST /auth/login and PATCH /profile/password, which re-issues after
 * bumping tokenVersion). Cross-site (different registrable domain) in a real
 * deployment needs SameSite=None+Secure to be sent at all; same-site
 * localhost dev (just a different port) works fine with Lax and no HTTPS.
 */
export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
};

/** `expiresAtUnix` is the token's own `exp` (seconds) so the cookie can't outlive the token. */
export function setSessionCookie(
  res: Response,
  accessToken: string,
  expiresAtUnix: number,
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...SESSION_COOKIE_OPTIONS,
    expires: new Date(expiresAtUnix * 1000),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: SESSION_COOKIE_OPTIONS.path });
}
