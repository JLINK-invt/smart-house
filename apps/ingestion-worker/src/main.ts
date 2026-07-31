import 'reflect-metadata';
import { telemetry } from './telemetry';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { WorkerService } from './worker.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  void app.get(WorkerService).start();
  process.on('SIGTERM', () => void telemetry.shutdown());
}

void bootstrap();
