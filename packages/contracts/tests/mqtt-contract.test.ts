import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  maxTelemetryPayloadBytes,
  parseTelemetryPayload,
  telemetrySchema,
} from '../src/mqtt';

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
