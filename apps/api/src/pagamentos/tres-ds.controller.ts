import { All, Controller, Header, Param } from '@nestjs/common';

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
    const ok = resultado === 'ok';
    const titulo = ok ? 'Compra confirmada no banco' : 'O banco não confirmou a compra';
    const texto = ok
      ? 'Pode voltar ao aplicativo: o pagamento aparece no pedido em instantes.'
      : 'Volte ao aplicativo e tente de novo, use outro cartão ou pague com PIX.';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;text-align:center;background:#fff;color:#1a1a1a}h1{font-size:20px}p{color:#555;line-height:1.5}</style></head>
<body><h1>${titulo}</h1><p>${texto}</p></body></html>`;
  }
}

/** Caminho da página de retorno (o app usa o prefixo pra fechar o WebView). Rede limita a 87 caracteres. */
export function urlsRetorno3ds(slug: string): { sucesso: string; falha: string } | null {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) return null;
  const raiz = `${base}/v1/pagamentos/3ds/${slug.toLowerCase()}`;
  return { sucesso: `${raiz}/ok`, falha: `${raiz}/falhou` };
}
