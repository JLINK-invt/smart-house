import { telemetry } from './telemetry';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { configureApi } from './api-setup';
import { AppModule } from './app.module';
import { readEnvironment } from './config/environment';

async function bootstrap() {
  const environment = readEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  configureApi(app);
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      const correlationId =
        request.headers['x-correlation-id'] ?? crypto.randomUUID();
      reply.header('x-correlation-id', correlationId);
      done();
    });

  await app.listen({ host: '0.0.0.0', port: environment.PORT });
  process.on('SIGTERM', () => void telemetry.shutdown());
}

void bootstrap();
