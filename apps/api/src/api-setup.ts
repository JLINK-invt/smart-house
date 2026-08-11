import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { readEnvironment, type Environment } from './config/environment';
import { HttpExceptionFilter } from './http/http-exception.filter';

export function configureApi(
  app: NestFastifyApplication,
  environment: Environment = readEnvironment(process.env),
): void {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: (origin, callback) =>
      callback(null, !origin || origin === environment.WEB_ORIGIN),
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
    maxAge: 86_400,
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request: FastifyRequest, reply, done) => {
      const isDocumentation = request.url.startsWith('/api/docs');
      reply
        .header('x-content-type-options', 'nosniff')
        .header('x-frame-options', 'DENY')
        .header('referrer-policy', 'no-referrer')
        .header(
          'permissions-policy',
          'camera=(), geolocation=(), microphone=()',
        )
        .header(
          'content-security-policy',
          isDocumentation
            ? "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
            : "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        );
      if (!isDocumentation) reply.header('cache-control', 'no-store');
      if (environment.NODE_ENV === 'production')
        reply.header(
          'strict-transport-security',
          'max-age=31536000; includeSubDomains',
        );
      done();
    });

  if (environment.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Smart House API')
        .setDescription('Smart House platform HTTP API')
        .setVersion('0.1.0')
        .build(),
    );

    SwaggerModule.setup('api/docs', app, document);
  }
}
