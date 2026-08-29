import { Role } from '../generated/prisma/enums';

/** Name of the httpOnly cookie carrying the JWT — shared between AuthController (set/clear) and JwtAuthGuard (read). */
export const ACCESS_TOKEN_COOKIE = 'access_token';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /** The user's tokenVersion at mint time — JwtAuthGuard rejects the token once the row's value moves past it (logout / password change). */
  tokenVersion: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
