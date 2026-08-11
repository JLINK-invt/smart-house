import { readWorkerConfig } from './config';

describe('readWorkerConfig', () => {
  it('uses the persisted telemetry outbox defaults', () => {
    expect(readWorkerConfig({})).toMatchObject({
      TELEMETRY_OUTBOX_STREAM_KEY: 'telemetry.persisted.stream',
      TELEMETRY_OUTBOX_PUBSUB_CHANNEL: 'telemetry.persisted',
      TELEMETRY_OUTBOX_POLL_INTERVAL_MS: 1_000,
      TELEMETRY_OUTBOX_BATCH_SIZE: 100,
    });
  });

  it('accepts custom relay polling and batch settings', () => {
    expect(
      readWorkerConfig({
        TELEMETRY_OUTBOX_POLL_INTERVAL_MS: '250',
        TELEMETRY_OUTBOX_BATCH_SIZE: '25',
      }),
    ).toMatchObject({
      TELEMETRY_OUTBOX_POLL_INTERVAL_MS: 250,
      TELEMETRY_OUTBOX_BATCH_SIZE: 25,
    });
  });

  it('uses local Mailpit SMTP and accepts a configurable relay', () => {
    expect(readWorkerConfig({})).toMatchObject({
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_FROM: 'alerts@smart-house.local',
    });
    expect(
      readWorkerConfig({ SMTP_HOST: 'mailpit', SMTP_PORT: '2525' }),
    ).toMatchObject({
      SMTP_HOST: 'mailpit',
      SMTP_PORT: 2525,
    });
  });
});
