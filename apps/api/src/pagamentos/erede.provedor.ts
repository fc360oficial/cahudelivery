import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import https from 'node:https';
import {
  CobrancaCriada,
  DadosCartao,
  NovaCobranca,
  PagamentoRecebido,
  ProvedorCartao,
  ResultadoCartao,
  SituacaoCobranca,
} from './provedor-pagamento';

export interface EredeConfig {
  pv: string;               // nº de filiação (clientId no OAuth) — sem zeros à esquerda
  chaveIntegracao: string;  // gerada no portal userede (clientSecret)
  softDescriptor?: string;  // aparece na fatura do portador junto ao nome da loja
  ambiente?: 'producao' | 'sandbox';
}

// OAuth 2.0 obrigatório desde 05/01/2026 (BASIC descontinuado); token dura 24 min
// e a Rede recomenda renovar entre 15 e 23 min. Autorização OAuth só na rota v2.
const HOSTS = {
  producao: { token: 'https://api.userede.com.br/redelabs/oauth2/token', transacoes: 'https://api.userede.com.br/erede/v2/transactions' },
  sandbox: { token: 'https://rl7-sandbox-api.useredecloud.com.br/oauth2/token', transacoes: 'https://sandbox-erede.useredecloud.com.br/v2/transactions' },
} as const;

const TIMEOUT_MS = 30_000;

interface RespostaHttp { status: number; body: any; texto: string }

/**
 * Cartão de crédito online na e.Rede (API v2, OAuth 2.0, captura automática).
 * Não existe "cobrança" no provedor antes do cartão: criarCobranca só abre a
 * janela local de pagamento; a transação nasce em cobrar(), uma referência
 * nova por tentativa (a e.Rede não aceita reference repetida).
 */
export class EredeProvedor implements ProvedorCartao {
  readonly nome = 'erede';
  readonly metodo = 'cartao' as const;
  private readonly log = new Logger('EredeProvedor');
  private token: { valor: string; expiraEm: number } | null = null;

  constructor(private readonly cfg: EredeConfig) {}

  private get hosts() {
    return HOSTS[this.cfg.ambiente === 'sandbox' ? 'sandbox' : 'producao'];
  }

  /** reference da e.Rede: até 16 alfanuméricos. "P" + pedido(6) + 9 aleatórios. */
  novaRef(numeroPedido: number): string {
    const aleatorio = randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 9).padEnd(9, 'X');
    return `P${String(numeroPedido % 1_000_000).padStart(6, '0')}${aleatorio}`;
  }

  /** Sem chamada de rede: só abre a janela local em que o cliente pode digitar o cartão. */
  async criarCobranca(p: NovaCobranca): Promise<CobrancaCriada> {
    return {
      ref: p.ref,
      copiaCola: null,
      expiraEm: new Date(Date.now() + p.expiracaoSegundos * 1000),
      payload: { provedor: 'erede', aguardandoCartao: true },
    };
  }

  async cobrar(ref: string, valor: number, cartao: DadosCartao): Promise<ResultadoCartao> {
    const corpo = {
      capture: true,
      kind: 'credit',
      reference: ref,
      amount: Math.round(valor * 100), // centavos, sem separadores
      cardholderName: sanearNome(cartao.nome),
      cardNumber: cartao.numero,
      expirationMonth: cartao.validadeMes,
      expirationYear: cartao.validadeAno,
      securityCode: cartao.cvv,
      ...(this.cfg.softDescriptor ? { softDescriptor: this.cfg.softDescriptor } : {}),
    };
    const r = await this.chamar('POST', '', corpo);
    const codigo = String(r.body?.returnCode ?? '');
    // 400 sem returnCode = requisição malformada (bug nosso), não recusa do emissor.
    if (!codigo && (r.status < 200 || r.status >= 300)) {
      throw new Error(`e.Rede transação ${r.status}: ${r.texto.slice(0, 300)}`);
    }
    if (codigo === '00') {
      this.log.log(`transação aprovada (ref=${ref}, tid=${r.body?.tid})`);
      return {
        aprovado: true, ref, codigo, mensagem: 'Pagamento aprovado',
        tid: r.body?.tid, autorizacao: r.body?.brand?.authorizationCode ?? r.body?.authorizationCode,
        payload: r.body,
      };
    }
    this.log.log(`transação recusada (ref=${ref}, codigo=${codigo}, brand=${r.body?.brand?.returnCode ?? '-'})`);
    return { aprovado: false, ref, codigo, mensagem: mensagemRecusa(codigo, r.body?.brand?.returnCode), payload: r.body };
  }

  async consultar(ref: string): Promise<SituacaoCobranca> {
    const r = await this.chamar('GET', `?reference=${encodeURIComponent(ref)}`);
    // 78 = transação não existe: cliente ainda não digitou o cartão (ou só teve recusas
    // em refs anteriores) — segue pendente e a expiração local (aplicarSituacao) decide.
    if (String(r.body?.returnCode) === '78' || r.status === 404) return { status: 'pendente', payload: r.body };
    if (r.status < 200 || r.status >= 300) throw new Error(`e.Rede consulta ${r.status}: ${r.texto.slice(0, 300)}`);
    return traduzirStatusErede(r.body);
  }

  /** e.Rede de cartão não tem webhook: confirmação é síncrona em cobrar(). */
  tratarWebhook(): PagamentoRecebido[] {
    return [];
  }

  // ---- HTTP ----

  private async obterToken(): Promise<string> {
    if (this.token && this.token.expiraEm > Date.now()) return this.token.valor;
    const url = new URL(this.hosts.token);
    const basic = Buffer.from(`${this.cfg.pv}:${this.cfg.chaveIntegracao}`).toString('base64');
    const body = 'grant_type=client_credentials';
    const r = await this.requisicao({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
    if (r.status !== 200 || !r.body?.access_token) throw new Error(`e.Rede OAuth ${r.status}: ${r.texto.slice(0, 200)}`);
    // expires_in ~24 min; renova com 4 min de folga (dentro da janela 15–23 min recomendada).
    this.token = { valor: r.body.access_token, expiraEm: Date.now() + (Number(r.body.expires_in) || 1440) * 1000 - 240_000 };
    this.log.log('token renovado');
    return this.token.valor;
  }

  private async chamar(method: 'GET' | 'POST', sufixo: string, corpo?: unknown): Promise<RespostaHttp> {
    const tentar = async (): Promise<RespostaHttp> => {
      const token = await this.obterToken();
      const base = new URL(this.hosts.transacoes);
      const data = corpo === undefined ? undefined : JSON.stringify(corpo);
      return this.requisicao({
        hostname: base.hostname, path: `${base.pathname}${sufixo}`, method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          // Recusas vêm com o código aberto da bandeira (padrão ABECS) no grupo "brand".
          'Transaction-Response': 'brand-return-opened',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      }, data);
    };
    let r = await tentar();
    if (r.status === 401) { // token invalidado no meio: renova uma vez
      this.log.warn('token 401, renovando uma vez');
      this.token = null;
      r = await tentar();
    }
    return r;
  }

  private requisicao(opts: https.RequestOptions, data?: string): Promise<RespostaHttp> {
    return new Promise((resolve, reject) => {
      const req = https.request({ ...opts, port: 443 }, (res) => {
        let texto = '';
        res.on('data', (c) => (texto += c));
        res.on('end', () => {
          let body: any = null;
          try { body = texto ? JSON.parse(texto) : null; } catch { body = null; }
          resolve({ status: res.statusCode ?? 0, body, texto });
        });
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('e.Rede: tempo esgotado na chamada')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
}

/** cardholderName: até 30, sem acento/caracteres especiais (exigência da e.Rede). */
export function sanearNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/**
 * GET /v2/transactions?reference= => authorization.status Approved/Denied/Canceled/Pending.
 * Denied fica 'pendente': o cliente pode tentar outro cartão até a janela local expirar.
 */
export function traduzirStatusErede(body: any): SituacaoCobranca {
  const st = String(body?.authorization?.status ?? '');
  if (st === 'Approved') {
    const valor = Number(body?.capture?.amount ?? body?.authorization?.amount) || 0;
    const quando = body?.capture?.dateTime ?? body?.authorization?.dateTime;
    return { status: 'pago', valorPago: valor / 100, pagoEm: quando ? new Date(quando) : new Date(), payload: body };
  }
  if (st === 'Canceled') return { status: 'cancelado', payload: body };
  return { status: 'pendente', payload: body };
}

/**
 * Mensagem pro cliente a partir do returnCode da Rede + código ABECS da bandeira.
 * Catálogo completo na doc da e.Rede (Returns); aqui só o que muda a ação do cliente.
 */
export function mensagemRecusa(codigo: string, codigoBandeira?: string): string {
  const cb = String(codigoBandeira ?? '');
  if (codigo === '111' || cb === '51' || cb === '116') return 'Cartão sem limite disponível. Tente outro cartão.';
  if (codigo === '112' || codigo === '79' || codigo === '86' || cb === '54') return 'Cartão vencido. Confira a validade.';
  if (codigo === '119' || cb === 'N7') return 'Código de segurança inválido. Confira o CVV no verso do cartão.';
  if (codigo === '109' || codigo === '114' || cb === '14' || cb === '15') return 'Número de cartão inválido. Confira os dados digitados.';
  if (codigo === '105' || codigo === '118' || cb === '41' || cb === '43' || cb === '57') return 'Transação não permitida para este cartão. Entre em contato com o banco emissor.';
  if (codigo === '103' || codigo === '104' || codigo === '106' || codigo === '107' || codigo === '121' || cb === '91' || cb === '96') return 'O banco emissor não respondeu. Tente novamente em instantes.';
  return 'Pagamento recusado pelo emissor do cartão. Tente outro cartão ou entre em contato com o banco.';
}