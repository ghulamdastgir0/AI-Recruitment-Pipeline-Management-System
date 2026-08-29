import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Unauthenticated liveness/startup probe. Deliberately does NOT touch the
 * database or any external service: a Cloud Run startup probe hitting this
 * only needs to know the HTTP server is up and accepting requests, and a
 * probe that fails whenever Postgres/Groq is briefly unreachable would keep
 * a perfectly healthy revision from ever going live.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe — returns 200 as soon as the server is accepting requests.' })
  check(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
