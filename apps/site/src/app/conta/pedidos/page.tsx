import type { Metadata } from 'next';
import { ListaPedidos } from '@/componentes/conta/ListaPedidos';
import { buscarConfig } from '@/lib/api/catalogo';

export const metadata: Metadata = { title: 'Meus pedidos' };

export default async function PaginaPedidos() {
  const config = await buscarConfig();
  return <ListaPedidos appNome={config.appNome} />;
}
