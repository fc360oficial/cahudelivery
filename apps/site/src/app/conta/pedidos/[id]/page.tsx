import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DetalhePedido } from '@/componentes/conta/DetalhePedido';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const metadata: Metadata = { title: 'Pedido' };

export default async function PaginaPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_INTEIRO.test(id)) notFound();
  return <DetalhePedido id={id.toLowerCase()} />;
}
