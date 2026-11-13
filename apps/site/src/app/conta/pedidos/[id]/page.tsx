import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DetalhePedido } from '@/componentes/conta/DetalhePedido';
import { buscarConfig } from '@/lib/api/catalogo';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';
import { checkoutLigado } from '@/lib/site';

export const metadata: Metadata = { title: 'Pedido' };

export default async function PaginaPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_INTEIRO.test(id)) notFound();
  // Só a config pública (com cache) e a chave do checkout são lidas no servidor; o pedido vem de /api/conta/*.
  const config = await buscarConfig();
  return <DetalhePedido id={id.toLowerCase()} checkoutLigado={checkoutLigado()} appNome={config.appNome} />;
}
