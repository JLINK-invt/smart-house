import { expect, test } from '@playwright/test';

const e2eUsername = process.env.PLAYWRIGHT_E2E_USERNAME;
const e2ePassword = process.env.PLAYWRIGHT_E2E_PASSWORD;

async function openDashboardNavigation(page: import('@playwright/test').Page) {
  const menuButton = page.getByRole('button', { name: 'Menu' });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
}

test('renders the Smart House product landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Smart House');
  await expect(
    page.getByRole('heading', { name: 'Todo lo que importa. Siempre a la vista.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todo lo necesario para operar una flota conectada.' })).toBeVisible();
});

test('redirects an unauthenticated dashboard request to the landing page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/');
});

test('opens the alert center after Keycloak login', async ({ page }) => {
  test.skip(
    !e2eUsername || !e2ePassword,
    'Requires PLAYWRIGHT_E2E_USERNAME and PLAYWRIGHT_E2E_PASSWORD for a Keycloak account.',
  );

  await page.goto('/login');
  await page.getByRole('link', { name: /Continuar con Keycloak/ }).click();

  await page.locator('input[name="username"]').fill(e2eUsername!);
  await page.locator('input[name="password"]').fill(e2ePassword!);
  await page.locator('#kc-login').click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await openDashboardNavigation(page);
  await page.getByRole('link', { name: 'Alertas' }).click();

  await expect(page).toHaveURL(/\/dashboard\/alerts$/);
  await expect(page.getByRole('heading', { name: 'Centro de alertas' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Alertas por organización' })).toBeVisible();
  await expect(page.getByLabel('Estado')).toBeVisible();
  await expect(page.getByLabel('Severidad')).toBeVisible();
});
