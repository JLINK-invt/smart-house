import { Test, TestingModule } from '@nestjs/testing';
import { healthResponseSchema } from '@smart-house/contracts';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { configureApi } from './../src/api-setup';
import { AppModule } from './../src/app.module';
import { SpikeGateway } from './../src/spike/spike.gateway';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SpikeGateway)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApi(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  it('/api/health (GET)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
  });

  it('/api/docs-json (GET)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs-json' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      info: { title: 'Smart House API' },
    });
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
  });

  it('does not grant CORS access to an untrusted origin', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'https://untrusted.example',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
