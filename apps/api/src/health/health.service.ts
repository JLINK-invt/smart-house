import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@smart-house/contracts';

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }
}
