import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Área do cliente contra a API local. Cria o próprio cliente de teste (nasce "pendente" e sem
// pedidos: as listas de pedidos e notas são conferidas no estado vazio).
const API = (process.env.E2E_API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const TENANT = process.env.TENANT ?? 'cahu';
const SENHA = 'Senha-e2e-7391';
const NOVA_SENHA = 'Outra-senha-e2e-5182';

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
      nomeFantasia: 'Mercearia Conta E2E',
      telefone: '81999990000',
      endereco: { cep: '50000000', logradouro: 'Rua de Teste', numero: '1', bairro: 'Centro', cidade: 'Recife', uf: 'PE' },
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return cpf;
}

/** Entra pela página /entrar já aberta; cadastro novo nasce "em análise" e mostra o aviso com "Continuar". */
async function entrar(page: Page, cpf: string, senha: string) {
  await page.getByLabel('CNPJ ou CPF').fill(cpf);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
}

const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 1, name: nome });

async function abrirMenuDaConta(page: Page, item: string) {
  await page.getByRole('button', { name: /Olá/ }).click();
  await page.getByRole('banner').getByRole('link', { name: item, exact: true }).click();
}

test('área do cliente: menu, seções, dados, endereço, senha e saída', async ({ page, request, context }) => {
  const cpf = await criarCliente(request);
  const cpfFormatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

  // Visitante em /conta/pedidos vai para "Entrar" e volta para lá depois do login.
  await page.goto('/conta/pedidos');
  await expect(page).toHaveURL(/\/entrar\?voltar=%2Fconta%2Fpedidos$/);
  await entrar(page, cpf, SENHA);
  await expect(page).toHaveURL(/\/conta\/pedidos$/);
  await expect(titulo(page, 'Meus pedidos')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByText('Nenhum pedido ainda')).toBeVisible();

  // Menu do nome: seções na ordem e "Sair" por último.
  await page.getByRole('button', { name: /Olá/ }).click();
  const menu = page.getByRole('banner').getByRole('navigation', { name: 'Minha conta' });
  await expect(menu.getByRole('link')).toHaveText(['Meus pedidos', 'Notas fiscais', 'Dados cadastrais', 'Endereços', 'Crédito', 'Carteira']);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sair' })).toBeVisible();
  await page.getByRole('button', { name: /Olá/ }).click();

  // Notas fiscais: vazio.
  await abrirMenuDaConta(page, 'Notas fiscais');
  await expect(titulo(page, 'Notas fiscais')).toBeVisible();
  await expect(page.getByText('Nenhuma nota fiscal ainda')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Você está em' })).toContainText('Minha conta');

  // Dados cadastrais do cliente criado.
  await abrirMenuDaConta(page, 'Dados cadastrais');
  await expect(titulo(page, 'Dados cadastrais')).toBeVisible();
  const cadastro = page.getByRole('region', { name: 'Cadastro' });
  await expect(cadastro).toContainText(cpfFormatado);
  await expect(cadastro).toContainText('Mercearia Conta E2E');
  await expect(cadastro).toContainText('(81) 99999-0000');
  await expect(cadastro).toContainText('Em análise');

  // Edita o nome fantasia: salva e o cabeçalho acompanha.
  await page.getByLabel('Nome fantasia').fill('Mercearia Renomeada E2E');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Olá, Mercearia Renomeada E2E/ })).toBeVisible();

  // Endereços: o do cadastro aparece; inclui um, vê na lista, exclui.
  await abrirMenuDaConta(page, 'Endereços');
  await expect(titulo(page, 'Endereços')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Seus endereços' })).toContainText('Rua de Teste');
  await page.getByRole('button', { name: 'Novo endereço' }).click();
  await page.getByLabel('CEP').fill('50030-230');
  // A busca de CEP (ViaCEP pelo servidor do site) depende da internet: espera ela terminar, sem exigir.
  await expect(page.getByText('Buscando CEP…')).toHaveCount(0, { timeout: 10_000 });
  const preencherSeVazio = async (rotulo: string, valor: string) => {
    const campo = page.getByLabel(rotulo, { exact: true });
    if (!(await campo.inputValue())) await campo.fill(valor);
  };
  await preencherSeVazio('Rua / Avenida', 'Cais do Apolo');
  await preencherSeVazio('Bairro', 'Recife');
  await preencherSeVazio('Cidade', 'Recife');
  await preencherSeVazio('UF', 'PE');
  await page.getByLabel('Número', { exact: true }).fill('925');
  await page.getByLabel('Apelido (opcional)').fill('Depósito E2E');
  await page.getByRole('button', { name: 'Salvar endereço' }).click();
  await expect(page.getByText('Endereço salvo.')).toBeVisible();
  const novo = page.getByRole('listitem').filter({ hasText: 'Depósito E2E' });
  await expect(novo).toContainText('925');
  await novo.getByRole('button', { name: 'Excluir' }).click();
  await novo.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(page.getByText('Endereço excluído.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Depósito E2E' })).toHaveCount(0);

  // Crédito (sem clicar em solicitar: não cria solicitação na retaguarda) e carteira vazios.
  await abrirMenuDaConta(page, 'Crédito');
  await expect(titulo(page, 'Crédito')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solicitar análise de crédito' })).toBeVisible();
  await abrirMenuDaConta(page, 'Carteira');
  await expect(titulo(page, 'Carteira')).toBeVisible();
  await expect(page.getByText('R$ 0,00')).toBeVisible();
  await expect(page.getByText('Sem movimentações')).toBeVisible();

  // Visão geral pela coluna lateral.
  await page.getByRole('link', { name: 'Visão geral' }).click();
  await expect(titulo(page, 'Minha conta')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Último pedido' })).toContainText('Você ainda não fez pedidos.');
  await expect(page.getByRole('region', { name: 'Carteira' })).toContainText('R$ 0,00');

  // Pedido que não existe (ou não é do cliente).
  await page.goto('/conta/pedidos/9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295');
  await expect(titulo(page, 'Pedido não encontrado')).toBeVisible();

  // Celular: sem rolagem horizontal em 390 px, menu vira faixa.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const caminho of ['/conta', '/conta/pedidos', '/conta/dados', '/conta/enderecos', '/conta/carteira']) {
    await page.goto(caminho);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0], `${caminho} rola na horizontal`).toBeLessThanOrEqual(larguras[1]);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Troca a senha: a atual errada é recusada; a certa troca.
  await page.goto('/conta/dados');
  const senha = page.getByRole('form', { name: 'Trocar senha' });
  await senha.getByLabel('Senha atual').fill('senha-errada-1');
  await senha.getByLabel('Nova senha', { exact: true }).fill(NOVA_SENHA);
  await senha.getByLabel('Confirme a nova senha').fill(NOVA_SENHA);
  await senha.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(senha.getByRole('alert')).toContainText('Senha atual incorreta');
  await senha.getByLabel('Senha atual').fill(SENHA);
  await senha.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(senha.getByText(/Senha alterada/)).toBeVisible();

  // A API derrubou as sessões antigas e mandou um par novo: sem o access token, a renovação usa
  // o refresh novo e o cliente continua logado (com o refresh antigo voltaria para "Entrar").
  const restantes = (await context.cookies()).filter((c) => c.name !== 'fc_acesso');
  await context.clearCookies();
  await context.addCookies(restantes);
  await page.goto('/conta/dados');
  await expect(titulo(page, 'Dados cadastrais')).toBeVisible();
  await expect(page).toHaveURL(/\/conta\/dados$/);

  // Sai: a área manda para "Entrar".
  await page.getByRole('button', { name: /Olá/ }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar\?voltar=/);
  await page.goto('/conta/pedidos');
  await expect(page).toHaveURL(/\/entrar\?voltar=%2Fconta%2Fpedidos$/);

  // A senha antiga não vale mais; a nova entra e volta para /conta/pedidos.
  await page.getByLabel('CNPJ ou CPF').fill(cpf);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'CNPJ/CPF ou senha inválidos' })).toBeVisible();
  await entrar(page, cpf, NOVA_SENHA);
  await expect(page).toHaveURL(/\/conta\/pedidos$/);
  await expect(titulo(page, 'Meus pedidos')).toBeVisible();
});

test('visitante: rotas /api/conta respondem 401 e nada de dado pessoal', async ({ request }) => {
  for (const caminho of ['/api/conta/resumo', '/api/conta/perfil', '/api/conta/pedidos', '/api/conta/notas', '/api/conta/enderecos', '/api/conta/credito', '/api/conta/carteira']) {
    const r = await request.get(caminho);
    expect(r.status(), caminho).toBe(401);
    expect(r.headers()['cache-control'], caminho).toContain('no-store');
  }
});
