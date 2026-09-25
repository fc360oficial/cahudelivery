import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { montarBrCode } from './br-code';
import { CobrancaCriada, NovaCobranca, PagamentoRecebido, ProvedorPagamento, SituacaoCobranca } from './provedor-pagamento';

export interface ItauPixConfig {
  chavePix: string;
  nomeRecebedor: string;
  cidade: string;
  clientId: string;
  clientSecret: string;
  pfx: Buffer;
  pfxSenha: string;
  /** Produção: https://secure.api.itau/pix_recebimentos/v2 (confirmar no 1º teste real; devportal itau-ep9-api-regulatorio-pix-v2-externo). */
  baseUrl?: string;
}

const STS_HOST = 'sts.itau.com.br';
const BASE_PADRAO = 'https://secure.api.itau/pix_recebimentos/v2';
const TIMEOUT_MS = 15_000;

interface RespostaHttp { status: number; body: any; texto: string }

/** Cobrança imediata (cob) na API PIX Recebimentos v2 do Itaú, com mTLS pelo .pfx do certificado dinâmico. */
export class ItauPixProvedor implements ProvedorPagamento {
  readonly nome = 'itau_pix';
  readonly metodo = 'pix' as const;
  private readonly log = new Logger('ItauPixProvedor');
  private token: { valor: string; expiraEm: number } | null = null;

  constructor(private readonly cfg: ItauPixConfig) {}

  async criarCobranca(p: NovaCobranca): Promise<CobrancaCriada> {
    const corpo = montarCorpoCob(p, this.cfg.chavePix);
    const r = await this.chamar('PUT', `/cob/${p.ref}`, corpo);
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Itaú PIX cob ${r.status}: ${r.texto.slice(0, 300)}`);
    }
    const criacao = r.body?.calendario?.criacao ? new Date(r.body.calendario.criacao) : new Date();
    const expiracao = Number(r.body?.calendario?.expiracao) || p.expiracaoSegundos;
    return {
      ref: r.body?.txid ?? p.ref,
      copiaCola: this.copiaColaDaResposta(r.body, p.ref),
      expiraEm: new Date(criacao.getTime() + expiracao * 1000),
      payload: r.body,
    };
  }

  async consultar(ref: string): Promise<SituacaoCobranca> {
    const r = await this.chamar('GET', `/cob/${ref}`);
    // 404 não é "cancelado": pode ser inconsistência transitória da API do Itaú (nunca dinheiro
    // real envolvido nessa distinção — cancelar por engano é pior que só deixar pendente).
    // A regra local de expiração (aplicarSituacao) cobre o caso de nunca existir de verdade.
    if (r.status === 404) return { status: 'pendente', payload: r.body };
    if (r.status < 200 || r.status >= 300) throw new Error(`Itaú PIX consulta ${r.status}: ${r.texto.slice(0, 300)}`);
    return traduzirStatusItau(r.body);
  }

  /** Corpo do webhook do Itaú: { "pix": [ { endToEndId, txid, valor, horario, ... } ] } */
  tratarWebhook(corpo: string): PagamentoRecebido[] {
    let j: any;
    try { j = JSON.parse(corpo); } catch { return []; }
    if (!Array.isArray(j?.pix)) return [];
    return j.pix
      .filter((x: any) => typeof x?.txid === 'string')
      .map((x: any) => ({ ref: x.txid, valorPago: Number(x.valor) || 0, pagoEm: x.horario ? new Date(x.horario) : new Date() }));
  }

  copiaColaDaResposta(body: any, txid: string): string | null {
    if (typeof body?.pixCopiaECola === 'string' && body.pixCopiaECola.length > 0) return body.pixCopiaECola;
    if (typeof body?.location === 'string' && body.location.length > 0) {
      return montarBrCode({ location: body.location, nomeRecebedor: this.cfg.nomeRecebedor, cidade: this.cfg.cidade, txid });
    }
    return null;
  }

  /** Registro único do webhook (setup): PUT /webhook/{chave} { webhookUrl }. */
  async registrarWebhook(webhookUrl: string): Promise<RespostaHttp> {
    return this.chamar('PUT', `/webhook/${this.cfg.chavePix}`, { webhookUrl });
  }

  // ---- HTTP ----

  private async obterToken(): Promise<string> {
    if (this.token && this.token.expiraEm > Date.now()) return this.token.valor;
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(this.cfg.clientId)}&client_secret=${encodeURIComponent(this.cfg.clientSecret)}`;
    const r = await this.requisicao({
      hostname: STS_HOST, path: '/api/oauth/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    if (r.status !== 200 || !r.body?.access_token) throw new Error(`Itaú STS ${r.status}: ${r.texto.slice(0, 200)}`);
    // expires_in = 300; renova com 1 min de folga.
    this.token = { valor: r.body.access_token, expiraEm: Date.now() + (Number(r.body.expires_in) || 300) * 1000 - 60_000 };
    this.log.log('token renovado');
    return this.token.valor;
  }

  private async chamar(method: 'GET' | 'PUT' | 'POST', caminho: string, corpo?: unknown): Promise<RespostaHttp> {
    const tentar = async (): Promise<RespostaHttp> => {
      const token = await this.obterToken();
      const base = new URL(this.cfg.baseUrl ?? BASE_PADRAO);
      const data = corpo === undefined ? undefined : JSON.stringify(corpo);
      return this.requisicao({
        hostname: base.hostname, path: `${base.pathname.replace(/\/$/, '')}${caminho}`, method,
        headers: {
          Authorization: `Bearer ${token}`,
          'x-itau-apikey': this.cfg.clientId,
          'x-itau-correlationID': randomUUID(),
          'Content-Type': 'application/json',
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
      const req = https.request({ ...opts, port: 443, pfx: this.cfg.pfx, passphrase: this.cfg.pfxSenha }, (res) => {
        let texto = '';
        res.on('data', (c) => (texto += c));
        res.on('end', () => {
          let body: any = null;
          try { body = texto ? JSON.parse(texto) : null; } catch { body = null; }
          resolve({ status: res.statusCode ?? 0, body, texto });
        });
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Itaú: tempo esgotado na chamada')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
}

/** Corpo do PUT /cob/{txid}: saneia o documento do devedor (só dígitos) antes de decidir CPF x CNPJ. */
export function montarCorpoCob(p: NovaCobranca, chavePix: string): Record<string, unknown> {
  return {
    calendario: { expiracao: p.expiracaoSegundos },
    valor: { original: p.valor.toFixed(2) },
    chave: chavePix,
    solicitacaoPagador: p.descricao.slice(0, 140),
    ...(p.pagador
      ? (() => {
          const doc = p.pagador!.documento.replace(/\D/g, '');
          return { devedor: doc.length > 11 ? { cnpj: doc, nome: p.pagador!.nome } : { cpf: doc, nome: p.pagador!.nome } };
        })()
      : {}),
  };
}

export function traduzirStatusItau(body: any): SituacaoCobranca {
  const st = String(body?.status ?? '');
  if (st === 'CONCLUIDA') {
    const pix = Array.isArray(body?.pix) && body.pix.length ? body.pix[body.pix.length - 1] : null;
    return {
      status: 'pago',
      valorPago: pix ? Number(pix.valor) || 0 : Number(body?.valor?.original) || 0,
      pagoEm: pix?.horario ? new Date(pix.horario) : new Date(),
      payload: body,
    };
  }
  if (st === 'REMOVIDA_PELO_PSP') return { status: 'expirado', payload: body };
  if (st === 'REMOVIDA_PELO_USUARIO_RECEBEDOR') return { status: 'cancelado', payload: body };
  return { status: 'pendente', payload: body };
}
