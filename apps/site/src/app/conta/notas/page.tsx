import type { Metadata } from 'next';
import { ListaNotas } from '@/componentes/conta/ListaNotas';

export const metadata: Metadata = { title: 'Notas fiscais' };

export default function PaginaNotas() {
  return <ListaNotas />;
}
