import { readConfig } from '../src/config';

describe('simulator configuration', () => {
  it('builds isolated topics for both devices', () => {
    const config = readConfig({});

    expect(config.temperatureTelemetryTopic).toBe(
      'tenants/demo/devices/temp-001/telemetry',
    );
    expect(config.relayTelemetryTopic).toBe(
      'tenants/demo/devices/relay-001/telemetry',
    );
    expect(config.relayCommandsTopic).toBe(
      'tenants/demo/devices/relay-001/commands',
    );
    expect(config.relayAcksTopic).toBe(
      'tenants/demo/devices/relay-001/command-acks',
    );
  });

  it('rejects publication intervals that would flood the broker', () => {
    expect(() => readConfig({ PUBLISH_INTERVAL_MS: '10' })).toThrow();
  });

  it('validates profile names and simulation seeds', () => {
    expect(() => readConfig({ SIMULATION_PROFILE: 'unknown' })).toThrow();
    expect(() => readConfig({ SIMULATION_SEED: '' })).toThrow();
    expect(
      readConfig({ SIMULATION_SEED: 'repeatable-run' }).SIMULATION_SEED,
    ).toBe('repeatable-run');
  });
});
