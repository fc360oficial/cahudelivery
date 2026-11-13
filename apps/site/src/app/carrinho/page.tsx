import type { Metadata } from 'next';
import { ItensCarrinho } from '@/componentes/ItensCarrinho';
import { buscarConfig } from '@/lib/api/catalogo';
import estilos from './carrinho.module.css';

export const metadata: Metadata = { title: 'Carrinho', robots: { index: false, follow: false } };

export default async function PaginaCarrinho() {
  const config = await buscarConfig();
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <h1>Seu carrinho</h1>
      <ItensCarrinho pedidoMinimo={config.pedidoMinimo} />
    </div>
  );
}
