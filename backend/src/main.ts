import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  // CORS_ORIGIN silently defaulting to '*' is fine for local dev/testing,
  // but would let any site call this API (and the interview WebSocket
  // gateway, which reads the same var) in a real deployment — so require it
  // explicitly once NODE_ENV=production.
  if (isProduction && !process.env.CORS_ORIGIN) {
    throw new Error(
      'CORS_ORIGIN must be set explicitly when NODE_ENV=production.',
    );
  }

  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      // Swagger UI's inline scripts/styles don't fit a default CSP, and the
      // docs are dev-only anyway (see the isProduction gate below) — the
      // other headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
      // still apply.
      contentSecurityPolicy: false,
      // Frontend and backend are always separate origins here (different
      // ports in dev, different Cloud Run services in prod) — Helmet's
      // default same-origin CORP header makes the browser itself block
      // <audio src>/<img src>/file-download requests at the network level
      // (ERR_BLOCKED_BY_RESPONSE), independent of and invisible to the CORS
      // config above. This is what silently broke interview question audio.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cookieParser());

  // credentials: true is required for the browser to send/accept the
  // httpOnly session cookie cross-origin (frontend and backend run on
  // different ports even in dev) — it also means origin can never be '*'
  // here, which the isProduction check above already guarantees for prod,
  // and .env sets an explicit CORS_ORIGIN for dev too.
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*', credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger publishes the full API surface (including the bearer-auth
  // scheme) to anyone who finds the URL — keep it to non-production only.
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('AI Recruitment Pipeline API')
      .setDescription('API documentation for the AI Recruitment Pipeline backend')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
