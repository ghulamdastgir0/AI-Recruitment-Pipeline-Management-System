import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function buildContext(user?: { role: string }) {
  const request = { user };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(requiredRoles: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as jest.Mocked<Reflector>;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no roles are required', () => {
    const guard = buildGuard(undefined);
    expect(guard.canActivate(buildContext({ role: 'HIRING_MANAGER' }))).toBe(
      true,
    );
  });

  it.each(['SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER'])(
    'allows %s when it is in the required role list',
    (role) => {
      const guard = buildGuard(['SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER']);
      expect(guard.canActivate(buildContext({ role }))).toBe(true);
    },
  );

  it('denies a role not in the required list', () => {
    const guard = buildGuard(['SUPER_ADMIN']);
    expect(() => guard.canActivate(buildContext({ role: 'HR_ADMIN' }))).toThrow(
      ForbiddenException,
    );
  });

  it('denies HIRING_MANAGER on a SUPER_ADMIN/HR_ADMIN-only route', () => {
    const guard = buildGuard(['SUPER_ADMIN', 'HR_ADMIN']);
    expect(() =>
      guard.canActivate(buildContext({ role: 'HIRING_MANAGER' })),
    ).toThrow(ForbiddenException);
  });

  it('denies when there is no authenticated user', () => {
    const guard = buildGuard(['SUPER_ADMIN']);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
