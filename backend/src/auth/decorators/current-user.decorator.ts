import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // Only used behind JwtAuthGuard, which always populates request.user before
    // the handler runs — the non-null assertion reflects that guarantee.
    return request.user!;
  },
);
