import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const requiredFiles = [
  'contracts/openapi/openapi.yaml',
  'contracts/asyncapi/telemetry.v1.yaml',
  'contracts/examples/telemetry/v1/temperature.valid.json',
  'contracts/examples/telemetry/v1/temperature-fahrenheit.valid.json',
  'contracts/examples/telemetry/v1/relay.valid.json',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing committed contract: ${file}`);
}

execFileSync('pnpm', ['--filter', '@smart-house/contracts', 'generate:http-client'], {
  stdio: 'inherit',
});
execFileSync('git', ['diff', '--exit-code', '--', 'packages/contracts/src/generated/openapi.ts'], {
  stdio: 'inherit',
});
execFileSync('pnpm', ['--filter', '@smart-house/contracts', 'test'], { stdio: 'inherit' });
