import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  commandAckSchema,
  maxCommandAckPayloadBytes,
  maxTelemetryPayloadBytes,
  parseCommandAckPayload,
  parseTelemetryPayload,
  relayCommandSchema,
  telemetrySchema,
} from '../src/mqtt';
import { createAlertRuleSchema, listNotificationsQuerySchema } from '../src/alerts';

const examples = '../../contracts/examples/telemetry/v1';
const readExample = (name: string) =>
  JSON.parse(readFileSync(`${examples}/${name}`, 'utf8'));

test('accepts the versioned Celsius, Fahrenheit, and relay examples', () => {
  for (const name of [
    'temperature.valid.json',
    'temperature-fahrenheit.valid.json',
    'relay.valid.json',
  ]) {
    assert.equal(telemetrySchema.safeParse(readExample(name)).success, true);
  }
});

test('rejects missing and unknown schema versions', () => {
  for (const name of [
    'missing-version.invalid.json',
    'unknown-version.invalid.json',
  ]) {
    assert.equal(telemetrySchema.safeParse(readExample(name)).success, false);
  }
});

test('rejects payloads larger than 8 KiB before JSON parsing', () => {
  assert.throws(
    () => parseTelemetryPayload('x'.repeat(maxTelemetryPayloadBytes + 1)),
    /exceeds 8192 bytes/,
  );
});

test('accepts only the versioned relay command contract', () => {
  const command = {
    schemaVersion: '1.0',
    commandId: 'cmd-001',
    nonce: 'nonce-001',
    tenantId: 'demo',
    deviceId: 'relay-001',
    commandType: 'relay.set',
    issuedAt: '2026-08-06T12:00:00.000Z',
    expiresAt: '2026-08-06T12:05:00.000Z',
    payload: { state: 'on' },
  };
  assert.equal(relayCommandSchema.safeParse(command).success, true);
  assert.equal(
    relayCommandSchema.safeParse({ ...command, schemaVersion: '2.0' }).success,
    false,
  );
  assert.equal(
    relayCommandSchema.safeParse({ ...command, payload: { state: 'invalid' } })
      .success,
    false,
  );
});

test('parses bounded command acknowledgements with the shared schema', () => {
  const acknowledgement = {
    schemaVersion: '1.0',
    messageId: 'ack-001',
    commandId: 'cmd-001',
    tenantId: 'demo',
    deviceId: 'relay-001',
    status: 'acknowledged',
    occurredAt: '2026-08-06T12:00:01.000Z',
    result: { state: 'on' },
  };
  assert.deepEqual(
    parseCommandAckPayload(JSON.stringify(acknowledgement)),
    commandAckSchema.parse(acknowledgement),
  );
  assert.throws(
    () => parseCommandAckPayload('x'.repeat(maxCommandAckPayloadBytes + 1)),
    /exceeds 8192 bytes/,
  );
});

test('accepts only finite threshold alert rule inputs', () => {
  const rule = {
    name: 'High kitchen temperature',
    deviceId: '2d77bf2a-cad4-4951-ae4c-9b21de4b11fe',
    metric: 'temperature',
    operator: 'gt',
    threshold: 30,
    durationSeconds: 60,
    hysteresis: 0.5,
    cooldownSeconds: 120,
  };
  assert.deepEqual(createAlertRuleSchema.parse(rule), {
    ...rule,
    type: 'threshold',
    severity: 'medium',
  });
  assert.deepEqual(
    createAlertRuleSchema.parse({
      name: rule.name,
      deviceId: rule.deviceId,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      type: 'threshold',
    }),
    {
      name: rule.name,
      deviceId: rule.deviceId,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      type: 'threshold',
      durationSeconds: 0,
      hysteresis: 0,
      cooldownSeconds: 0,
      severity: 'medium',
    },
  );
  assert.equal(
    createAlertRuleSchema.safeParse({ ...rule, threshold: Infinity }).success,
    false,
  );
  assert.equal(
    createAlertRuleSchema.safeParse({ ...rule, operator: 'above' }).success,
    false,
  );
  assert.equal(
    createAlertRuleSchema.safeParse({ ...rule, cooldownSeconds: -1 }).success,
    false,
  );
});

test('accepts only explicit notification inbox filters', () => {
  assert.equal(listNotificationsQuerySchema.safeParse({ unreadOnly: 'true' }).success, true);
  assert.equal(listNotificationsQuerySchema.safeParse({ unreadOnly: 'yes' }).success, false);
  assert.equal(listNotificationsQuerySchema.safeParse({ unexpected: 'true' }).success, false);
});
