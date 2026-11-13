import type { Metadata } from 'next';
import { ListaPedidos } from '@/componentes/conta/ListaPedidos';

export const metadata: Metadata = { title: 'Meus pedidos' };

/** ?aviso=conferir vem do /finalizar quando o envio ficou sem resposta e o carrinho esvaziou. */
export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { aviso } = await searchParams;
  return <ListaPedidos avisoConferir={aviso === 'conferir'} />;
}
