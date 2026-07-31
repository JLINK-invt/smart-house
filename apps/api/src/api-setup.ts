import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HttpExceptionFilter } from './http/http-exception.filter';

export function configureApi(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());

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
