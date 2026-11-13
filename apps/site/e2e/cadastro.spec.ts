import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Cadastro de cliente novo pelo site contra a API LOCAL (cria clientes de verdade no banco de desenvolvimento).
const API = (process.env.E2E_API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const TENANT = process.env.TENANT ?? 'cahu';
const SENHA = 'Senha-e2e-cadastro-5821';

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${API}/`)) {
  throw new Error(`cadastro.spec cria clientes de verdade: só roda contra a API local (recebeu ${API}).`);
}

const aleatorios = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10));

/** Dígito verificador no módulo 11 (resto < 2 vira 0), com os pesos dados. */
const digito = (nums: number[], pesos: number[]) => {
  const resto = nums.reduce((t, n, i) => t + n * pesos[i]!, 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
};

function gerarCnpj(): string {
  const base = [...aleatorios(8), 0, 0, 0, 1];
  if (base.slice(0, 8).every((d) => d === base[0])) base[7] = (base[0]! + 1) % 10;
  const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join('');
}

function gerarCpf(): string {
  const base = aleatorios(9);
  if (base.every((d) => d === base[0])) base[8] = (base[0]! + 1) % 10;
  const d1 = digito(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito([...base, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join('');
}

/**
 * Cada teste fala com o site como um visitante de IP próprio (o proxy grava o x-forwarded-for):
 * assim o limite de cadastros por IP do site não trava execuções repetidas.
 */
async function visitanteComIpProprio(context: BrowserContext) {
  const parte = () => 1 + Math.floor(Math.random() * 250);
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${parte()}.${parte()}.${parte()}` });
}

/** Busca o CEP; se o serviço externo estiver fora, preenche à mão e registra (não falha por causa de terceiro). */
async function preencherEndereco(page: Page): Promise<boolean> {
  await page.getByLabel('CEP', { exact: true }).fill('51210050');
  const rua = page.getByLabel('Rua / Avenida');
  const achou = await expect(rua).not.toHaveValue('', { timeout: 15_000 }).then(() => true, () => false);
  if (achou) {
    await expect(page.getByLabel('Cidade')).toHaveValue('Recife');
    await expect(page.getByLabel('UF')).toHaveValue('PE');
  } else {
    test.info().annotations.push({ type: 'cep', description: 'Busca de CEP indisponível: endereço preenchido à mão.' });
    await rua.fill('Rua de Teste');
    await page.getByLabel('Bairro').fill('Boa Viagem');
    await page.getByLabel('Cidade').fill('Recife');
    await page.getByLabel('UF').fill('PE');
  }
  await page.getByLabel('Número').fill('100');
  return achou;
}

async function preencherSenhas(page: Page) {
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByLabel('Confirmar senha').fill(SENHA);
}

test('cadastro pelo site: em análise, logado, carrinho do visitante preservado', async ({ page, context, request }) => {
  await visitanteComIpProprio(context);
  const cnpj = gerarCnpj();

  // Visitante põe um produto no carrinho.
  await page.goto('/');
  const cartao = page.getByTestId('cartao-produto').first();
  const nome = (await cartao.getByRole('link').last().innerText()).trim();
  await cartao.getByRole('link').last().click();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByRole('button', { name: 'No carrinho' })).toBeVisible();

  // "Criar conta" no cabeçalho leva ao cadastro.
  await page.getByRole('banner').getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cadastrar$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  await page.getByLabel('CNPJ', { exact: true }).fill(cnpj);
  await expect(page.getByLabel('CNPJ', { exact: true })).toHaveValue(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
  await page.getByLabel('Nome fantasia').fill('Mercadinho Cadastro E2E');
  await page.getByLabel('Isento de Inscrição Estadual').check();
  await expect(page.getByLabel('Inscrição Estadual', { exact: true })).toBeDisabled();
  await page.getByLabel('Telefone / WhatsApp').fill('81999990000');
  await expect(page.getByLabel('Telefone / WhatsApp')).toHaveValue('(81) 99999-0000');
  await page.getByLabel('Categoria do estabelecimento (opcional)').selectOption('Mercearia e Conveniência');
  const cepAchado = await preencherEndereco(page);
  await preencherSenhas(page);

  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Cadastro enviado' })).toBeVisible();
  await expect(page.getByText('A distribuidora vai analisar e liberar suas compras.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continuar comprando' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Minha conta' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Olá/ })).toBeVisible();

  // Tokens só em cookie HttpOnly.
  const cookies = await context.cookies();
  for (const nomeCookie of ['fc_acesso', 'fc_renova']) {
    const c = cookies.find((k) => k.name === nomeCookie);
    expect(c, nomeCookie).toBeTruthy();
    expect(c?.httpOnly).toBe(true);
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('fc_');

  // O que a API gravou: em análise, telefone em dígitos e o código do município da busca de CEP.
  const token = cookies.find((c) => c.name === 'fc_acesso')!.value;
  const comToken = { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}` } };
  const perfil = (await (await request.get(`${API}/perfil`, comToken)).json()) as Record<string, unknown>;
  expect(perfil).toMatchObject({ documento: cnpj, tipo: 'CNPJ', status: 'pendente', nome_fantasia: 'Mercadinho Cadastro E2E', telefone: '81999990000' });
  const enderecos = (await (await request.get(`${API}/perfil/enderecos`, comToken)).json()) as Record<string, unknown>[];
  expect(enderecos).toHaveLength(1);
  expect(enderecos[0]).toMatchObject({ cep: '51210050', numero: '100', padrao: true });
  if (cepAchado) expect(enderecos[0]!.codigo_municipio).toBe('2611606');

  // O carrinho montado como visitante continua, agora com o aviso de cadastro em análise.
  await page.goto('/carrinho');
  await expect(page.getByText(nome).first()).toBeVisible();
  const desligado = page.getByText(/^Fechamento do pedido pelo site em breve\./);
  await expect(desligado.or(page.getByText('Seu cadastro está em análise'))).toBeVisible();

  // Já logado, /cadastrar manda para a conta.
  await page.goto('/cadastrar');
  await expect(page).toHaveURL(/\/conta$/);
});

test('documento já cadastrado: mostra a mensagem da API e o link "Entrar"', async ({ page, context, request }) => {
  await visitanteComIpProprio(context);
  const cpf = gerarCpf();
  const r = await request.post(`${API}/auth/registrar`, {
    headers: { 'X-Tenant': TENANT },
    data: {
      tipo: 'CPF', documento: cpf, nomeFantasia: 'Cliente Existente E2E', telefone: '81999990000',
      endereco: { cep: '50000000', logradouro: 'Rua de Teste', numero: '1', bairro: 'Centro', cidade: 'Recife', uf: 'PE' },
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(201);

  await page.goto('/cadastrar');
  await page.getByRole('radio', { name: 'Pessoa física (CPF)' }).check();
  await page.getByLabel('CPF', { exact: true }).fill(cpf);
  await page.getByLabel('Nome do negócio').fill('Tentativa Repetida E2E');
  await page.getByLabel('Telefone / WhatsApp').fill('81988887777');
  await preencherEndereco(page);
  await preencherSenhas(page);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

  const alerta = page.getByRole('alert').filter({ hasText: 'Já existe cadastro para este CNPJ/CPF. Use Entrar.' });
  await expect(alerta).toBeVisible();
  await expect(alerta.getByRole('link', { name: 'Entrar', exact: true })).toHaveAttribute('href', '/entrar');
  await expect(alerta.getByRole('link', { name: 'Primeiro acesso ou esqueci minha senha' })).toBeVisible();
  // Os dados continuam na tela, menos as senhas; ninguém entrou.
  await expect(page.getByLabel('Nome do negócio')).toHaveValue('Tentativa Repetida E2E');
  await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Confirmar senha')).toHaveValue('');
  expect((await context.cookies()).find((c) => c.name === 'fc_acesso')).toBeUndefined();

  // "Primeiro acesso ou esqueci minha senha" abre o modo do código em /entrar.
  await alerta.getByRole('link', { name: 'Primeiro acesso ou esqueci minha senha' }).click();
  await expect(page.getByLabel('Código da distribuidora')).toBeVisible();
});

test('erros de validação aparecem junto dos campos sem chamar a API', async ({ page, context }) => {
  await visitanteComIpProprio(context);
  let chamadas = 0;
  await page.route('**/api/sessao/cadastro', (rota) => {
    chamadas += 1;
    return rota.continue();
  });

  // "Criar conta" também aparece na tela de login.
  await page.goto('/entrar');
  // O cabeçalho também tem "Criar conta": aqui vale o link do corpo da tela de login.
  await page.getByRole('main').getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cadastrar$/);

  await page.getByLabel('CNPJ', { exact: true }).fill('11222333000182');
  await page.getByLabel('Inscrição Estadual', { exact: true }).fill('123');
  await page.getByLabel('E-mail (opcional)').fill('sem-arroba');
  await page.getByLabel('Telefone / WhatsApp').fill('81');
  await page.getByLabel('Senha', { exact: true }).fill('abcdefg');
  await page.getByLabel('Confirmar senha').fill('abcdefh');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

  const resumo = page.getByRole('alert').filter({ hasText: /Confira \d+ campos/ });
  await expect(resumo).toBeVisible();

  const documento = page.getByLabel('CNPJ', { exact: true });
  await expect(documento).toBeFocused();
  await expect(documento).toHaveAttribute('aria-invalid', 'true');
  await expect(documento).toHaveAccessibleDescription(/CNPJ inválido/);
  await expect(page.getByLabel('Nome fantasia')).toHaveAccessibleDescription(/Campo obrigatório/);
  await expect(page.getByLabel('Inscrição Estadual', { exact: true })).toHaveAccessibleDescription(/Inscrição Estadual inválida/);
  await expect(page.getByLabel('E-mail (opcional)')).toHaveAccessibleDescription(/E-mail inválido/);
  await expect(page.getByLabel('Telefone / WhatsApp')).toHaveAccessibleDescription(/Informe o telefone com DDD/);
  await expect(page.getByLabel('CEP', { exact: true })).toHaveAccessibleDescription(/CEP inválido/);
  await expect(page.getByLabel('Confirmar senha')).toHaveAccessibleDescription(/As senhas não conferem/);
  expect(chamadas).toBe(0);

  // Senha fraca (regra da API) também é recusada aqui, antes de gastar uma tentativa.
  await page.getByLabel('Senha', { exact: true }).fill('123456');
  await page.getByLabel('Confirmar senha').fill('123456');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAccessibleDescription(/Essa senha é fácil de adivinhar/);
  expect(chamadas).toBe(0);
});
