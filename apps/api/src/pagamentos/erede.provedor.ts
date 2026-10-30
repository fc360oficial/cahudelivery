import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import https from 'node:https';
import {
  CobrancaCriada,
  ConfigPreAutorizacao,
  Contexto3ds,
  DadosCartao,
  NovaCobranca,
  PagamentoRecebido,
  ProvedorCartao,
  ResultadoCaptura,
  ResultadoCartao,
  ResultadoEstorno,
  SituacaoCobranca,
} from './provedor-pagamento';

export interface EredeConfig {
  pv: string;               // nº de filiação (clientId no OAuth) — sem zeros à esquerda
  chaveIntegracao: string;  // gerada no portal userede (clientSecret)
  softDescriptor?: string;  // aparece na fatura do portador junto ao nome da loja
  ambiente?: 'producao' | 'sandbox';
  /**
   * 3DS 2.0 pelo MPI da Rede. Só ligar depois de contratar no portal useRede
   * (para vender > e-commerce > 3DS > contratar) — sem contrato a Rede devolve 203.
   * seFalhar 'recusar' (padrão) = cartão que não autentica não é cobrado: é o que
   * passa a responsabilidade de chargeback por fraude pro emissor. 'continuar'
   * cobra mesmo sem autenticar (sem essa proteção).
   */
  tresDS?: { ativo: boolean; seFalhar?: 'recusar' | 'continuar' };
  /**
   * Pré-autorização: reserva no checkout (capture:false) e cobra o valor da NF-e no
   * faturamento (PUT /v2/transactions/{tid}). Só ligar depois que a Rede confirmar que
   * está liberada no PV, o prazo de captura do ramo e a captura parcial.
   */
  preAutorizacao?: { ativa: boolean; prazoHoras?: number; folgaHoras?: number };
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

  get usa3ds(): boolean {
    return this.cfg.tresDS?.ativo === true;
  }

  /**
   * Sem prazo confirmado, assume 72 h (conservador): cobrar antes da hora só gera
   * estorno de diferença; deixar a reserva cair é entregar sem receber.
   */
  get preAutorizacao(): ConfigPreAutorizacao | null {
    const p = this.cfg.preAutorizacao;
    if (p?.ativa !== true) return null;
    const prazoHoras = Number(p.prazoHoras) > 0 ? Number(p.prazoHoras) : 72;
    const folgaHoras = Number(p.folgaHoras) > 0 ? Math.min(Number(p.folgaHoras), prazoHoras / 2) : Math.min(12, prazoHoras / 2);
    return { ativa: true, prazoHoras, folgaHoras };
  }

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

  async cobrar(
    ref: string,
    valor: number,
    cartao: DadosCartao,
    ctx3ds?: Contexto3ds,
    opts: { capturar?: boolean } = {},
  ): Promise<ResultadoCartao> {
    if (this.usa3ds && !ctx3ds) throw new Error('e.Rede: 3DS ligado mas o checkout não mandou os dados do aparelho');
    const corpo = {
      capture: opts.capturar !== false,
      kind: 'credit',
      reference: ref,
      amount: Math.round(valor * 100), // centavos, sem separadores
      cardholderName: sanearNome(cartao.nome),
      cardNumber: cartao.numero,
      expirationMonth: cartao.validadeMes,
      expirationYear: cartao.validadeAno,
      securityCode: cartao.cvv,
      ...(this.cfg.softDescriptor ? { softDescriptor: this.cfg.softDescriptor } : {}),
      ...(this.usa3ds && ctx3ds ? corpo3ds(ctx3ds, this.cfg.tresDS?.seFalhar ?? 'recusar') : {}),
    };
    const r = await this.chamar('POST', '', corpo);
    const codigo = String(r.body?.returnCode ?? '');
    const codigo3ds = r.body?.threeDSecure?.returnCode != null ? String(r.body.threeDSecure.returnCode) : undefined;
    // 400 sem returnCode = requisição malformada (bug nosso), não recusa do emissor.
    if (!codigo && (r.status < 200 || r.status >= 300)) {
      throw new Error(`e.Rede transação ${r.status}: ${r.texto.slice(0, 300)}`);
    }
    if (codigo === '00') {
      this.log.log(`transação aprovada (ref=${ref}, tid=${r.body?.tid}, 3ds=${codigo3ds ?? '-'})`);
      return {
        aprovado: true, ref, codigo, mensagem: 'Pagamento aprovado',
        tid: r.body?.tid, autorizacao: r.body?.brand?.authorizationCode ?? r.body?.authorizationCode,
        codigo3ds, payload: r.body,
      };
    }
    // 220 = emissor pediu desafio: a Rede só autoriza depois que o cliente se autentica
    // na URL do emissor; o resultado vem pela consulta por reference.
    if (codigo === '220' && r.body?.threeDSecure?.url) {
      this.log.log(`3DS com desafio (ref=${ref})`);
      return {
        aprovado: false, ref, codigo, mensagem: 'Confirme a compra no aplicativo ou site do seu banco',
        urlAutenticacao: String(r.body.threeDSecure.url), codigo3ds: '220', payload: r.body,
      };
    }
    this.log.log(`transação recusada (ref=${ref}, codigo=${codigo}, 3ds=${codigo3ds ?? '-'}, brand=${r.body?.brand?.returnCode ?? '-'})`);
    return {
      aprovado: false, ref, codigo, codigo3ds,
      mensagem: mensagemRecusa(codigo, r.body?.brand?.returnCode, codigo3ds), payload: r.body,
    };
  }

  /**
   * POST /v2/transactions/{tid}/refunds. No mesmo dia da venda a Rede cancela na
   * hora (359); depois disso aceita e processa em D+1 (360) — o worker confirma
   * pela consulta da transação (status Canceled).
   */
  /**
   * PUT /v2/transactions/{tid} com o valor a cobrar (≤ reservado). É aqui que a
   * cobrança vai pra fatura do cliente. Falha ambígua (timeout): quem chama
   * confere pela consulta antes de tentar de novo — a Rede pede pra nunca
   * repetir a captura sem a resposta da anterior.
   */
  async capturar(tid: string, valor: number): Promise<ResultadoCaptura> {
    let r: RespostaHttp;
    try {
      r = await this.chamar('PUT', `/${encodeURIComponent(tid)}`, { amount: Math.round(valor * 100) });
    } catch (e) {
      return { ok: false, codigo: '', mensagem: `Rede fora do ar: ${e}`, tentarDeNovo: true, payload: null };
    }
    const codigo = String(r.body?.returnCode ?? '');
    if (codigo === '00') return { ok: true, codigo, mensagem: 'Cobrança feita', payload: r.body };
    return {
      ok: false, codigo, payload: r.body,
      tentarDeNovo: !codigo && (r.status === 0 || r.status >= 500),
      mensagem: String(r.body?.returnMessage ?? '') || `Rede respondeu HTTP ${r.status}`,
    };
  }

  async estornar(tid: string, valor: number): Promise<ResultadoEstorno> {
    let r: RespostaHttp;
    try {
      r = await this.chamar('POST', `/${encodeURIComponent(tid)}/refunds`, { amount: Math.round(valor * 100) });
    } catch (e) {
      return { status: 'falhou', codigo: '', mensagem: `Rede fora do ar: ${e}`, tentarDeNovo: true, payload: null };
    }
    return traduzirEstorno(r.status, r.body);
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

  private async chamar(method: 'GET' | 'POST' | 'PUT', sufixo: string, corpo?: unknown): Promise<RespostaHttp> {
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
  const tid = body?.authorization?.tid ? String(body.authorization.tid) : undefined;
  const codigo3ds = body?.threeDSecure?.returnCode != null ? String(body.threeDSecure.returnCode) : undefined;
  if (st === 'Approved') {
    const valor = Number(body?.capture?.amount ?? body?.authorization?.amount) || 0;
    const quando = body?.capture?.dateTime ?? body?.authorization?.dateTime;
    // Grupo capture só existe depois da cobrança; sem ele, é reserva (pré-autorização).
    const capturado = Number(body?.capture?.amount) > 0;
    return {
      status: 'pago', valorPago: valor / 100, pagoEm: quando ? new Date(quando) : new Date(), tid, codigo3ds,
      capturado, valorCapturado: capturado ? Number(body.capture.amount) / 100 : undefined, payload: body,
    };
  }
  if (st === 'Canceled') return { status: 'cancelado', tid, codigo3ds, payload: body };
  return { status: 'pendente', tid, codigo3ds, negada: st === 'Denied', payload: body };
}

/**
 * Bloco threeDSecure + urls da requisição (manual e.Rede v1.29, "3DS 2.0 – Rede MPI").
 * O desafio abre num WebView do app, por isso deviceType3ds BROWSER. As URLs de
 * retorno têm limite de 87 caracteres na Rede.
 */
export function corpo3ds(ctx: Contexto3ds, seFalhar: 'recusar' | 'continuar') {
  const soDigitos = (v: string) => String(v ?? '').replace(/\D/g, '');
  const cep = soDigitos(ctx.cobranca.cep);
  for (const u of [ctx.urlSucesso, ctx.urlFalha]) {
    if (u.length > 87) throw new Error(`e.Rede: URL de retorno do 3DS passa de 87 caracteres (${u})`);
  }
  return {
    threeDSecure: {
      embedded: true,
      onFailure: seFalhar === 'continuar' ? 'continue' : 'decline',
      userAgent: String(ctx.userAgent || 'Mozilla/5.0').slice(0, 255),
      ipAddress: ctx.ip,
      device: {
        colorDepth: ctx.dispositivo.profundidadeCor,
        deviceType3ds: 'BROWSER',
        javaEnabled: false,
        language: String(ctx.dispositivo.idioma || 'pt-BR').slice(0, 8),
        screenHeight: Math.round(ctx.dispositivo.altura),
        screenWidth: Math.round(ctx.dispositivo.largura),
        timeZoneOffset: ctx.dispositivo.fusoHoras,
      },
      billing: {
        address: semAcento(ctx.cobranca.endereco).slice(0, 128),
        city: semAcento(ctx.cobranca.cidade).slice(0, 64),
        postalCode: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
        state: ctx.cobranca.uf,
        country: 'Brasil',
        emailAddress: ctx.cobranca.email.slice(0, 128),
        phoneNumber: soDigitos(ctx.cobranca.telefone).slice(0, 32),
      },
    },
    urls: [
      { kind: 'threeDSecureSuccess', url: ctx.urlSucesso },
      { kind: 'threeDSecureFailure', url: ctx.urlFalha },
    ],
  };
}

function semAcento(v: string): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Retornos de cancelamento da e.Rede (tabela "Cancellation returns"). */
export function traduzirEstorno(httpStatus: number, body: any): ResultadoEstorno {
  const codigo = String(body?.returnCode ?? '');
  const mensagem = String(body?.returnMessage ?? '');
  const refundId = body?.refundId ? String(body.refundId) : undefined;
  if (codigo === '359') return { status: 'concluido', codigo, mensagem: 'Estorno feito na Rede', refundId, payload: body };
  if (codigo === '360') return { status: 'solicitado', codigo, mensagem: 'Estorno aceito pela Rede, processa no próximo dia útil', refundId, payload: body };
  // 355 = já cancelada (outro canal, ou reenvio nosso): o dinheiro já voltou.
  if (codigo === '355') return { status: 'concluido', codigo, mensagem: 'Transação já estava cancelada na Rede', refundId, payload: body };
  const passageiro = codigo === '368' || codigo === '370' || (!codigo && (httpStatus === 0 || httpStatus >= 500));
  const motivos: Record<string, string> = {
    '351': 'Rede não permitiu o estorno (Forbidden)',
    '353': 'Transação não encontrada na Rede',
    '354': 'Prazo de estorno vencido — devolver por PIX/transferência',
    '357': 'Valor do estorno maior que o da venda',
    '358': 'Valor do estorno maior que o disponível',
    '365': 'Estorno parcial não disponível pra esta transação',
    '373': 'A Rede não aceita mais estornos nesta transação',
    '374': 'Cliente já abriu chargeback — o estorno sai pela disputa, não por aqui',
  };
  return {
    status: 'falhou', codigo, tentarDeNovo: passageiro, refundId, payload: body,
    mensagem: motivos[codigo] ?? (mensagem || `Rede respondeu HTTP ${httpStatus}`),
  };
}

/**
 * Mensagem pro cliente a partir do returnCode da Rede + código ABECS da bandeira.
 * Catálogo completo na doc da e.Rede (Returns); aqui só o que muda a ação do cliente.
 */
export function mensagemRecusa(codigo: string, codigoBandeira?: string, codigo3ds?: string): string {
  if (codigo3ds === '202') return 'O banco não confirmou que a compra é sua. Tente de novo ou use outro cartão.';
  if (codigo3ds === '203') return 'Pagamento com cartão indisponível no momento. Use o PIX ou fale com a distribuidora.';
  if (codigo3ds === '204') return 'Este cartão não tem verificação de segurança ativa no banco. Use outro cartão ou o PIX.';
  const cb = String(codigoBandeira ?? '');
  if (codigo === '111' || cb === '51' || cb === '116') return 'Cartão sem limite disponível. Tente outro cartão.';
  if (codigo === '112' || codigo === '79' || codigo === '86' || cb === '54') return 'Cartão vencido. Confira a validade.';
  if (codigo === '119' || cb === 'N7') return 'Código de segurança inválido. Confira o CVV no verso do cartão.';
  if (codigo === '109' || codigo === '114' || cb === '14' || cb === '15') return 'Número de cartão inválido. Confira os dados digitados.';
  if (codigo === '105' || codigo === '118' || cb === '41' || cb === '43' || cb === '57') return 'Transação não permitida para este cartão. Entre em contato com o banco emissor.';
  if (codigo === '103' || codigo === '104' || codigo === '106' || codigo === '107' || codigo === '121' || cb === '91' || cb === '96') return 'O banco emissor não respondeu. Tente novamente em instantes.';
  return 'Pagamento recusado pelo emissor do cartão. Tente outro cartão ou entre em contato com o banco.';
}