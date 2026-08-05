import { expect, test } from '@playwright/test';

test('renders the Smart House product landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Smart House');
  await expect(
    page.getByRole('heading', { name: 'Todo lo que importa. Siempre a la vista.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todo lo necesario para operar una flota conectada.' })).toBeVisible();
});

test('opens the dashboard through the preview login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('demo@smart-house.local');
  await page.getByLabel('Contraseña').fill('preview-session');
  await page.getByRole('button', { name: 'Acceder en modo vista previa →' }).click();

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByText('Resumen en vivo')).toBeVisible();
});

test('protects the dashboard route until a session exists', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/');

  await page.context().addCookies([
    {
      name: 'smart-house-session',
      value: 'test-session',
      url: 'http://localhost:3100',
    },
  ]);
  await page.goto('/dashboard');

  await expect(
    page.getByRole('heading', { name: 'Listo para conectar tu flota.' }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'La plataforma ya tiene pulso.' }),
  ).toBeVisible();
  await expect(page.getByText('2 dispositivos', { exact: true })).toBeVisible();
  await expect(page.getByText('Comandos', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Telemetría del spike' })).toBeVisible();
  await expect(page.getByText('28.4 °C', { exact: true })).toBeVisible();
});

test('navigates dashboard features from the expandable menu', async ({ page }) => {
  await page.context().addCookies([
    { name: 'smart-house-session', value: 'test-session', url: 'http://localhost:3100' },
  ]);
  await page.goto('/dashboard');

  const menuButton = page.getByRole('button', { name: 'Menu' });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
  await page.getByRole('link', { name: 'Dispositivos' }).click();

  await expect(page).toHaveURL('/dashboard/inventory');
  await expect(page.getByRole('heading', { name: 'Gestión de dispositivos' })).toBeVisible();
});
