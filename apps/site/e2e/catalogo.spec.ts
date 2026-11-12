import { expect, test } from '@playwright/test';

test('início mostra produtos com preço e não é indexável', async ({ page }) => {
  await page.goto('/');
  const cartao = page.getByTestId('cartao-produto').first();
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText('R$');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('do cartão à página do produto, e adicionar ao carrinho', async ({ page }) => {
  await page.goto('/');
  const cartao = page.getByTestId('cartao-produto').first();
  const nome = (await cartao.getByRole('link').last().innerText()).trim();
  await cartao.getByRole('link').last().click();

  await expect(page).toHaveURL(/\/p\/.+-[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(nome);

  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByTestId('contador-carrinho')).toBeVisible();
  await expect(page.getByRole('button', { name: 'No carrinho' })).toBeVisible();

  await page.getByRole('link', { name: /Carrinho/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Seu carrinho' })).toBeVisible();
  await expect(page.getByText(nome).first()).toBeVisible();
});

test('categoria ordena por preço pela URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Categorias' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/c\/.+-[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Menor preço' }).click();
  await expect(page).toHaveURL(/ordem=preco_asc/);
  await expect(page.getByTestId('cartao-produto').first()).toBeVisible();
});

test('busca sem resultado e endereço inexistente', async ({ page }) => {
  await page.goto('/busca?q=zzzzqqqqxxxx');
  await expect(page.getByText('Nenhum produto encontrado')).toBeVisible();
  const resp = await page.goto('/p/nao-existe');
  expect(resp?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
});

test('cabeçalhos de segurança presentes', async ({ request }) => {
  const r = await request.get('/');
  expect(r.headers()['x-frame-options']).toBe('DENY');
  expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
});
