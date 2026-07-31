import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError } from '@smart-house/contracts';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = isHttpException ? exception.getResponse() : null;
    const responseMessage =
      typeof response === 'object' && response !== null
        ? (response as { message?: unknown }).message
        : response;
    const message =
      typeof responseMessage === 'string' || Array.isArray(responseMessage)
        ? responseMessage
        : !isHttpException
          ? 'Internal server error'
          : 'Request failed';

    const body: ApiError = {
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    reply.status(status).send(body);
  }
}
