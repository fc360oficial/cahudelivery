import { All, Controller, Header, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

/** A Rede recusa URL de retorno do 3DS com mais de 87 caracteres (ver corpo3ds no erede.provedor). */
const LIMITE_URL_REDE = 87;
const RESULTADOS = ['ok', 'falhou'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const log = new Logger('TresDs');

/** Página de hoje (app): o WebView fecha pelo caminho; no navegador fica a mensagem. */
function paginaRetorno(resultado: string): string {
  const ok = resultado === 'ok';
  const titulo = ok ? 'Compra confirmada no banco' : 'O banco não confirmou a compra';
  const texto = ok
    ? 'Pode voltar ao aplicativo: o pagamento aparece no pedido em instantes.'
    : 'Volte ao aplicativo e tente de novo, use outro cartão ou pague com PIX.';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;text-align:center;background:#fff;color:#1a1a1a}h1{font-size:20px}p{color:#555;line-height:1.5}</style></head>
<body><h1>${titulo}</h1><p>${texto}</p></body></html>`;
}

/**
 * Página pra onde o emissor manda o cliente depois do desafio 3DS
 * (threeDSecureSuccess / threeDSecureFailure). Não decide nada: quem confirma
 * o pagamento é a consulta por reference (app ou worker). O WebView do app
 * reconhece este caminho e fecha sozinho; no navegador fica a mensagem.
 * Rota fora do TenancyMiddleware — o banco não manda o header X-Tenant.
 */
@Controller('pagamentos/3ds/:tenant')
export class TresDsController {
  @All(':resultado')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  retorno(@Param('resultado') resultado: string) {
    return paginaRetorno(resultado);
  }

  /**
   * Pagamento iniciado pelo site (X-Canal: site no pagar-cartao): a própria API pôs
   * o código do pedido no fim da URL de retorno. Com tudo válido e o site do tenant
   * configurado, devolve o navegador à página do pedido no site; senão, a página de hoje.
   */
  @All(':resultado/:pedido')
  retornoSite(
    @Param('tenant') tenant: string,
    @Param('resultado') resultado: string,
    @Param('pedido') pedido: string,
    @Res() res: Response,
  ) {
    res.set('Cache-Control', 'no-store');
    const destino = destinoRetornoSite(tenant, resultado, pedido);
    if (destino) return res.redirect(302, destino);
    res.set('Content-Type', 'text/html; charset=utf-8').send(paginaRetorno(resultado));
  }
}

/** UUID do pedido em 22 caracteres base64url: com ele a URL de retorno cabe nos 87 da Rede. */
export function codigoPedido3ds(pedidoId: string): string {
  return Buffer.from(pedidoId.replace(/-/g, ''), 'hex').toString('base64url');
}

/** Inverso de codigoPedido3ds; qualquer coisa fora da forma exata que a API gera vira null. */
export function pedidoDoCodigo3ds(codigo: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(codigo)) return null;
  const bytes = Buffer.from(codigo, 'base64url');
  if (bytes.length !== 16 || bytes.toString('base64url') !== codigo) return null;
  const h = bytes.toString('hex');
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return UUID.test(uuid) ? uuid : null;
}

/**
 * Destino do retorno do 3DS pro site. Só três coisas entram na URL: a base
 * configurada no servidor (SITE_URL_<TENANT>), o uuid decodificado e validado, e
 * o resultado se for 'ok' ou 'falhou'. Nenhum outro texto da requisição.
 */
export function destinoRetornoSite(tenant: string, resultado: string, codigo: string): string | null {
  if (!/^[a-z0-9_]{1,40}$/i.test(tenant)) return null;
  if (!(RESULTADOS as readonly string[]).includes(resultado)) return null;
  const pedidoId = pedidoDoCodigo3ds(codigo);
  if (!pedidoId) return null;
  const base = baseDoSite(process.env[`SITE_URL_${tenant.toUpperCase()}`]);
  if (!base) return null;
  return `${base}/conta/pedidos/${pedidoId}?pagamento=${resultado}`;
}

/** Só aceita http(s) absoluto, sem query, fragmento ou usuário; tira a barra final. */
function baseDoSite(valor: string | undefined): string | null {
  if (!valor) return null;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.search || u.hash || u.username || u.password) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Caminho da página de retorno (o app usa o prefixo pra fechar o WebView). Rede limita a 87 caracteres.
 * Com `pedidoSite` (pagamento iniciado pelo site), o código do pedido vai no fim; se assim
 * passar do limite, ficam as URLs do app (o pagamento segue, só não volta sozinho pro site).
 */
export function urlsRetorno3ds(slug: string, pedidoSite?: string): { sucesso: string; falha: string } | null {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) return null;
  const raiz = `${base}/v1/pagamentos/3ds/${slug.toLowerCase()}`;
  const app = { sucesso: `${raiz}/ok`, falha: `${raiz}/falhou` };
  if (!pedidoSite) return app;
  const codigo = codigoPedido3ds(pedidoSite);
  const site = { sucesso: `${raiz}/ok/${codigo}`, falha: `${raiz}/falhou/${codigo}` };
  if (site.falha.length > LIMITE_URL_REDE) {
    log.error(`URL de retorno do 3DS pro site passa de ${LIMITE_URL_REDE} caracteres; usando a do app (${site.falha})`);
    return app;
  }
  return site;
}
