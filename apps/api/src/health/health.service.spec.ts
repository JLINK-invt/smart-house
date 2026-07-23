import { healthResponseSchema } from '@smart-house/contracts';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns a response that matches the public contract', () => {
    const response = new HealthService().getHealth();

    expect(healthResponseSchema.safeParse(response).success).toBe(true);
  });
});
