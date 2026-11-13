import type { Metadata } from 'next';
import { Finalizar } from '@/componentes/checkout/Finalizar';
import { buscarConfig } from '@/lib/api/catalogo';
import { checkoutLigado, linkWhatsapp } from '@/lib/site';

// Página só do cliente logado: casca no servidor (config pública da loja), dados pelas rotas
// /api/conta/* no navegador, como as páginas de /conta. Nunca indexada, nunca em cache.
export const metadata: Metadata = { title: 'Finalizar pedido', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PaginaFinalizar() {
  const config = await buscarConfig();
  return (
    <Finalizar
      formasPagamento={config.formasPagamento}
      cartaoOnline={config.cartaoOnline}
      cartaoEmBreve={config.cartaoEmBreve}
      condicoesBoleto={config.condicoesBoleto}
      pedidoMinimo={config.pedidoMinimo}
      whatsapp={linkWhatsapp(config.contatoWhatsapp)}
      checkoutLigado={checkoutLigado()}
      appNome={config.appNome}
    />
  );
}
