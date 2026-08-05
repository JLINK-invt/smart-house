import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);

test.skip(process.env.SPIKE_E2E !== 'true', 'Requires local API, worker, Redis, PostgreSQL, and MQTT.');

test('delivers persisted simulator telemetry to the dashboard over WebSocket', async ({ page }) => {
  await page.context().addCookies([
    { name: 'smart-house-session', value: 'spike-session', url: 'http://localhost:3100' },
  ]);
  await page.goto('/dashboard');
  await expect(page.getByText('Escuchando actualizaciones en vivo...')).toBeVisible();

  const startedAt = performance.now();
  await execFileAsync('pnpm', ['--filter', '@smart-house/simulador', 'start'], {
    cwd: process.cwd(),
    env: { ...process.env, PUBLISH_ONCE: 'true' },
  });

  await expect(page.getByText(/Actualización en vivo: msg-/)).toBeVisible();
  expect(performance.now() - startedAt).toBeLessThan(5_000);
});
