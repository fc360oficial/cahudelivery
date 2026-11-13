import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

// Fechamento do pedido contra a API LOCAL (cria pedidos de verdade no banco de desenvolvimento).
// Cada teste cria o próprio cliente; ele nasce "pendente" e a API recusa pedido, então o teste o
// aprova com UM comando no Postgres local (só o cliente que ele mesmo criou).
const API = (process.env.E2E_API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const TENANT = process.env.TENANT ?? 'cahu';
const PSQL = process.env.E2E_PSQL ?? 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
const BANCO = process.env.E2E_BANCO ?? `fluxo_t_${TENANT}`;
const SENHA = 'Senha-e2e-checkout-4471';

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${API}/`)) {
  throw new Error(`checkout.spec cria pedidos de verdade: só roda contra a API local (recebeu ${API}).`);
}

function gerarCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (base.every((d) => d === base[0])) base[8] = (base[0] + 1) % 10;
  const digito = (nums: number[]) => {
    const resto = (nums.reduce((t, n, i) => t + n * (nums.length + 1 - i), 0) * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base);
  return [...base, d1, digito([...base, d1])].join('');
}

async function criarClienteAprovado(request: APIRequestContext): Promise<string> {
  const cpf = gerarCpf();
  const r = await request.post(`${API}/auth/registrar`, {
    headers: { 'X-Tenant': TENANT },
    data: {
      tipo: 'CPF', documento: cpf, nomeFantasia: 'Mercearia Checkout E2E', telefone: '81999990000',
      endereco: { cep: '50000000', logradouro: 'Rua de Teste', numero: '1', bairro: 'Centro', cidade: 'Recife', uf: 'PE' },
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  // O documento é só dígitos gerados aqui: nada de texto de fora entra no SQL.
  expect(cpf).toMatch(/^\d{11}$/);
  execFileSync(PSQL, ['-h', 'localhost', '-U', 'postgres', '-d', BANCO, '-c', `update clientes set status='aprovado' where documento='${cpf}'`], {
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' },
    stdio: 'pipe',
  });
  return cpf;
}

async function entrar(page: Page, cpf: string, voltar: string) {
  await page.goto(`/entrar?voltar=${encodeURIComponent(voltar)}`);
  await page.getByLabel('CNPJ ou CPF').fill(cpf);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Olá/ })).toBeVisible();
}

interface ProdutoApi { id: string; nome: string; estoque: string | number; preco: string | number | null; qtd_minima: string | number }

async function produtoComEstoque(request: APIRequestContext): Promise<ProdutoApi> {
  const r = await request.get(`${API}/produtos?limite=50`, { headers: { 'X-Tenant': TENANT } });
  const { dados } = (await r.json()) as { dados: ProdutoApi[] };
  const p = dados.find((x) => Number(x.preco) > 0 && Number(x.estoque) >= Math.max(2, Number(x.qtd_minima) * 2) && Number(x.estoque) < 9000);
  if (!p) throw new Error('nenhum produto com preço e estoque na API local');
  return p;
}

/** Põe no carrinho pela rota do próprio site (mesmo caminho do botão Adicionar; Origin do site). */
async function porNoCarrinho(page: Page, produtoId: string, quantidade: number) {
  const base = new URL(page.url()).origin;
  const r = await page.request.put('/api/carrinho/itens', { headers: { Origin: base }, data: { produtoId, quantidade } });
  expect(r.status(), await r.text()).toBe(200);
}

/** Pedido como a API devolve ao cliente (lido com o token do próprio cliente de teste). */
async function pedidoNaApi(context: BrowserContext, request: APIRequestContext, id: string) {
  const token = (await context.cookies()).find((c) => c.name === 'fc_acesso')?.value;
  const r = await request.get(`${API}/pedidos/${id}`, { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}` } });
  expect(r.status()).toBe(200);
  return (await r.json()) as Record<string, unknown>;
}

test.skip(!existsSync(PSQL), `psql não encontrado em ${PSQL} (defina E2E_PSQL)`);

test('cliente aprovado fecha o pedido: entrega em endereço novo, PIX, confirmar e página do pedido', async ({ page, request, context }) => {
  const cpf = await criarClienteAprovado(request);
  const produto = await produtoComEstoque(request);
  const quantidade = Math.max(1, Number(produto.qtd_minima));

  // Visitante em /finalizar vai para "Entrar" e volta para lá.
  await page.goto('/finalizar');
  await expect(page).toHaveURL(/\/entrar\?voltar=%2Ffinalizar$/);

  await entrar(page, cpf, '/carrinho');
  await porNoCarrinho(page, produto.id, quantidade);
  await page.goto('/carrinho');
  await expect(page.getByText(produto.nome).first()).toBeVisible();
  await page.getByRole('link', { name: 'Finalizar pedido' }).click();
  await expect(page).toHaveURL(/\/finalizar$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Finalizar pedido' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Etapas' })).toContainText('Entrega');

  // 1. Entrega com endereço novo cadastrado ali mesmo.
  await expect(page.getByRole('radio', { name: 'Entrega', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Novo endereço' }).click();
  await page.getByLabel('CEP', { exact: true }).fill('50030-230');
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
  await page.getByLabel('Apelido (opcional)').fill('Depósito Checkout E2E');
  await page.getByRole('button', { name: 'Salvar endereço' }).click();
  await expect(page.getByRole('radio', { name: /Depósito Checkout E2E/ })).toBeChecked();
  await page.getByLabel('Observações (opcional)').fill('Entregar pela manhã (E2E)');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 2. Pagamento: PIX.
  await expect(page.getByRole('heading', { name: 'Como pagar?' })).toBeVisible();
  await page.getByRole('radio', { name: /^PIX/ }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 3. Revisão e confirmação (duplo clique: um pedido só).
  await expect(page.getByRole('heading', { name: 'Revise seu pedido' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Itens do pedido' })).toContainText(produto.nome);
  await expect(page.getByText('Cais do Apolo, 925').or(page.getByText(/, 925/)).first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar pedido' }).dblclick();

  await expect(page).toHaveURL(/\/conta\/pedidos\/[0-9a-f-]{36}\?novo=1$/, { timeout: 20_000 });
  const id = /\/conta\/pedidos\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByRole('heading', { level: 1, name: /Pedido nº \d+/ })).toBeVisible();
  await expect(page.getByText('Recebemos seu pedido.')).toBeVisible();

  // O que a API gravou: origem site, endereço novo, observações, PIX; e o carrinho esvaziou.
  const pedido = await pedidoNaApi(context, request, id);
  expect(pedido.origem).toBe('site');
  expect(pedido.forma_pagamento).toBe('pix');
  expect(pedido.tipo_entrega).toBe('entrega');
  expect((pedido.endereco_snapshot_json as { numero?: string }).numero).toBe('925');
  expect(pedido.observacoes).toBe('Entregar pela manhã (E2E)');
  const token = (await context.cookies()).find((c) => c.name === 'fc_acesso')?.value;
  const lista = await (await request.get(`${API}/pedidos`, { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}` } })).json();
  expect((lista as { dados: unknown[] }).dados).toHaveLength(1);
  await page.goto('/carrinho');
  await expect(page.getByText('Seu carrinho está vazio.')).toBeVisible();
});

test('recusa da API aparece com a mensagem dela (estoque insuficiente)', async ({ page, request }) => {
  const cpf = await criarClienteAprovado(request);
  const produto = await produtoComEstoque(request);
  await entrar(page, cpf, '/carrinho');
  // A API aceita no carrinho mais do que o estoque; quem recusa é o POST pedidos.
  await porNoCarrinho(page, produto.id, Math.floor(Number(produto.estoque)) + 1);
  await page.goto('/finalizar');
  await page.getByRole('radio', { name: 'Retirar na loja' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Estoque insuficiente' })).toContainText(`Estoque insuficiente: ${produto.nome}`);
  await expect(page).toHaveURL(/\/finalizar$/);
  // Recusa não trava a tela: dá para voltar e corrigir.
  await expect(page.getByRole('button', { name: 'Confirmar pedido' })).toBeEnabled();
});

/** Pedido de verdade (retirada, PIX) pela rota do site, para os testes da página do pedido. */
async function pedidoPeloSite(page: Page, request: APIRequestContext): Promise<string> {
  const produto = await produtoComEstoque(request);
  await porNoCarrinho(page, produto.id, Math.max(1, Number(produto.qtd_minima)));
  const base = new URL(page.url()).origin;
  const r = await page.request.post('/api/conta/pedidos', { headers: { Origin: base }, data: { tipoEntrega: 'retirada', formaPagamento: 'pix' } });
  expect(r.status(), await r.text()).toBe(201);
  const corpo = (await r.json()) as Record<string, unknown>;
  // Só o necessário volta ao navegador (nada de copia-e-cola nem dados do provedor aqui).
  expect(Object.keys(corpo).sort()).toEqual(['id', 'numero', 'pagamento', 'status']);
  return corpo.id as string;
}

// A API local NÃO tem provedor PIX ativo (pagamento_provedores vazio no banco de controle): o
// pedido PIX nasce RECEBIDO, sem cobrança, e não há como chegar a um PIX pendente de verdade.
// Este teste usa um pedido real, mas reescreve NO NAVEGADOR a resposta de /api/conta/pedidos/<id>
// para "aguardando PIX" e depois para "pago": prova a tela (QR, copia-e-cola, prazo, consulta
// periódica que muda sozinha), não o provedor nem a rota do QR.
test('página do pedido: PIX pendente mostra QR e copia-e-cola e muda sozinha para pago (respostas simuladas no navegador)', async ({ page, request, context }) => {
  const cpf = await criarClienteAprovado(request);
  await entrar(page, cpf, '/carrinho');
  const id = await pedidoPeloSite(page, request);
  const COPIA_COLA = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
  let pago = false;
  let consultas = 0;
  await page.route(`**/api/conta/pedidos/${id}`, async (rota) => {
    consultas += 1;
    const real = await rota.fetch();
    const pedido = (await real.json()) as Record<string, unknown>;
    const expiraEm = new Date(Date.now() + 10 * 60_000).toISOString();
    const simulado = pago
      ? { ...pedido, status: 'RECEBIDO', pagamento: { metodo: 'pix', status: 'pago', valor: pedido.total, expiraEm, pagoEm: new Date().toISOString(), copiaCola: null } }
      : { ...pedido, status: 'AGUARDANDO_PAGAMENTO', pagamento: { metodo: 'pix', status: 'pendente', valor: pedido.total, expiraEm, pagoEm: null, copiaCola: COPIA_COLA } };
    await rota.fulfill({ response: real, json: simulado });
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto(`/conta/pedidos/${id}`);
  await expect(page.getByRole('heading', { name: /^Pague R\$ .* com PIX$/ })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^Expira em (09|10):\d\d$/);
  await expect(page.getByRole('img', { name: 'QR Code do PIX' })).toHaveAttribute('src', new RegExp(`^/api/conta/pedidos/${id}/pix-qr\\?v=`));
  await expect(page.getByLabel('PIX copia e cola')).toHaveValue(COPIA_COLA);
  await page.getByRole('button', { name: 'Copiar código' }).click();
  await expect(page.getByText('Código PIX copiado!')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COPIA_COLA);

  // O "banco" confirma: a próxima consulta (5 s) traz pago e a tela muda sem recarregar.
  const antes = consultas;
  pago = true;
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('PIX copia e cola')).toHaveCount(0);
  expect(consultas).toBeGreaterThan(antes);
  // Pago: a consulta para.
  const depois = consultas;
  await page.waitForTimeout(7_000);
  expect(consultas).toBe(depois);
});

// Também sem provedor de cartão na API local. Só a resposta do GET do pedido é reescrita no
// navegador ("aguardando cartão"); o POST do cartão e a conferência do 3DS vão de verdade pelas
// rotas do site até a API, que responde o real: este pedido não tem pagamento com cartão (404).
test('página do pedido: cartão pendente (simulado) – formulário, envio chega à API (404: pedido sem cartão) e volta do 3DS forjada não mostra "pago"', async ({ page, request }) => {
  const cpf = await criarClienteAprovado(request);
  await entrar(page, cpf, '/carrinho');
  const id = await pedidoPeloSite(page, request);
  await page.route(`**/api/conta/pedidos/${id}`, async (rota) => {
    const real = await rota.fetch();
    const pedido = (await real.json()) as Record<string, unknown>;
    await rota.fulfill({
      response: real,
      json: { ...pedido, status: 'AGUARDANDO_PAGAMENTO', formaPagamento: 'cartao', pagamento: { metodo: 'cartao', status: 'pendente', valor: pedido.total, expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(), pagoEm: null, copiaCola: null } },
    });
  });
  const enviados: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/pagar-cartao')) enviados.push(r.url()); });

  await page.goto(`/conta/pedidos/${id}`);
  await expect(page.getByRole('heading', { name: /com cartão de crédito$/ })).toBeVisible();
  const form = page.getByRole('form', { name: 'Pagar com cartão de crédito' });
  await expect(form.getByLabel('Número do cartão')).toHaveAttribute('autocomplete', 'cc-number');
  await expect(form.getByLabel('Nome impresso no cartão')).toHaveAttribute('autocomplete', 'cc-name');
  await expect(form.getByLabel('Validade (MM/AA)')).toHaveAttribute('autocomplete', 'cc-exp');
  await expect(form.getByLabel('Código de segurança (CVV)')).toHaveAttribute('autocomplete', 'cc-csc');

  // Número com erro de digitação: barrado no navegador, nada enviado.
  await form.getByLabel('Número do cartão').fill('4111111111111112');
  await form.getByLabel('Nome impresso no cartão').fill('Maria Teste');
  await form.getByLabel('Validade (MM/AA)').fill('1230');
  await form.getByLabel('Código de segurança (CVV)').fill('123');
  await form.getByRole('button', { name: /^Pagar/ }).click();
  await expect(form.getByRole('alert')).toHaveText('Confira o número do cartão.');
  expect(enviados).toHaveLength(0);

  // Cartão de teste válido: vai pela rota do site até a API, que responde 404 (este pedido não tem cartão).
  await form.getByLabel('Número do cartão').fill('4111111111111111');
  await expect(form.getByLabel('Número do cartão')).toHaveValue('4111 1111 1111 1111');
  await form.getByRole('button', { name: /^Pagar/ }).click();
  await expect(form.getByRole('alert')).toHaveText('Este pedido não tem pagamento com cartão em aberto. A página foi atualizada.');
  await expect(form.getByLabel('Código de segurança (CVV)')).toHaveValue(''); // CVV não fica na tela
  expect(enviados.some((u) => u.endsWith(`/api/conta/pedidos/${id}/pagar-cartao`))).toBe(true);
  expect(enviados.join(' ')).not.toContain('4111'); // nada do cartão na URL

  // Volta do banco forjada (?pagamento=ok): a página confere com a API e NÃO mostra "pago".
  await page.goto(`/conta/pedidos/${id}?pagamento=ok`);
  await expect(page).toHaveURL(new RegExp(`/conta/pedidos/${id}$`));
  await expect(page.getByText('O banco não confirmou a compra. Tente de novo, use outro cartão ou pague com PIX.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toHaveCount(0);
  expect(enviados.some((u) => u.endsWith('/pagar-cartao/confirmar'))).toBe(true);
});

test('pedido abaixo do mínimo: recusa da API', async ({ page, request }) => {
  const cfg = (await (await request.get(`${API}/config`, { headers: { 'X-Tenant': TENANT } })).json()) as {
    configuracoes?: { pedido_minimo?: { valor?: unknown } };
  };
  const minimo = Number(cfg.configuracoes?.pedido_minimo?.valor ?? 0);
  test.skip(!(minimo > 0), 'a API local está sem pedido mínimo (pedido_minimo.valor = 0): não há recusa por mínimo para provocar');
  const cpf = await criarClienteAprovado(request);
  const produto = await produtoComEstoque(request);
  await entrar(page, cpf, '/carrinho');
  await porNoCarrinho(page, produto.id, Math.max(1, Number(produto.qtd_minima)));
  test.skip(Number(produto.preco) * Math.max(1, Number(produto.qtd_minima)) >= minimo, 'o produto escolhido já atinge o mínimo');
  await page.goto('/carrinho');
  await expect(page.getByText(/Faltam R\$ .* para o mínimo de R\$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalizar pedido' })).toBeDisabled();
  // Direto em /finalizar o site deixa a API decidir.
  await page.goto('/finalizar');
  await page.getByRole('radio', { name: 'Retirar na loja' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Pedido mínimo' })).toBeVisible();
});
