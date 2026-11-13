import type { Metadata } from 'next';
import { Enderecos } from '@/componentes/conta/Enderecos';

export const metadata: Metadata = { title: 'Endereços' };

export default function PaginaEnderecos() {
  return <Enderecos />;
}
