import { expect, test, type APIRequestContext } from '@playwright/test';

// Cria o próprio cliente de teste na API local (cadastro novo pode nascer "pendente"; o login funciona igual).
const API = (process.env.E2E_API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const TENANT = process.env.TENANT ?? 'cahu';
const SENHA = 'Senha-e2e-7391';

/** CPF válido aleatório (dígitos verificadores calculados). */
function gerarCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (base.every((d) => d === base[0])) base[8] = (base[0] + 1) % 10;
  const digito = (nums: number[]) => {
    const soma = nums.reduce((t, n, i) => t + n * (nums.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base);
  const d2 = digito([...base, d1]);
  return [...base, d1, d2].join('');
}

async function criarCliente(request: APIRequestContext): Promise<string> {
  const cpf = gerarCpf();
  const r = await request.post(`${API}/auth/registrar`, {
    headers: { 'X-Tenant': TENANT },
    data: {
      tipo: 'CPF',
      documento: cpf,
      nomeFantasia: 'Mercearia Teste E2E',
      telefone: '81999990000',
      endereco: { cep: '50000000', logradouro: 'Rua de Teste', numero: '1', bairro: 'Centro', cidade: 'Recife', uf: 'PE' },
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return cpf;
}

test('entrar: senha errada, login, carrinho do visitante passa para o cliente, sair', async ({ page, request, context }) => {
  const cpf = await criarCliente(request);

  // Visitante adiciona um produto.
  await page.goto('/');
  const cartao = page.getByTestId('cartao-produto').first();
  const nome = (await cartao.getByRole('link').last().innerText()).trim();
  await cartao.getByRole('link').last().click();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByRole('button', { name: 'No carrinho' })).toBeVisible();

  // Botão "Entrar" do cabeçalho leva à página de login.
  await page.getByRole('link', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // Senha errada mostra o erro.
  await page.getByLabel('CNPJ ou CPF').fill(cpf);
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'CNPJ/CPF ou senha inválidos' })).toBeVisible();

  // Senha certa: cabeçalho vira "Olá".
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Olá/ })).toBeVisible();

  // Tokens só em cookie HttpOnly: o JavaScript da página não os vê.
  const cookies = await context.cookies();
  for (const nomeCookie of ['fc_acesso', 'fc_renova']) {
    const c = cookies.find((k) => k.name === nomeCookie);
    expect(c, nomeCookie).toBeTruthy();
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Lax');
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('fc_');

  // O item adicionado como visitante continua no carrinho (agora o do cliente).
  await page.goto('/carrinho');
  await expect(page.getByText(nome).first()).toBeVisible();
  await expect(page.getByText(/Fechamento do pedido pelo site em breve/)).toBeVisible();

  // Sair volta a mostrar "Entrar".
  await page.getByRole('button', { name: /Olá/ }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible();
  // O carrinho do visitante foi passado ao cliente no login: de volta como visitante, ele está vazio.
  await expect(page.getByText('Seu carrinho está vazio.')).toBeVisible();
  const depois = await context.cookies();
  expect(depois.find((k) => k.name === 'fc_acesso')).toBeUndefined();
  expect(depois.find((k) => k.name === 'fc_renova')).toBeUndefined();
});
