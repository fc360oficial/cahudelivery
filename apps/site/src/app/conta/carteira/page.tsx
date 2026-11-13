import type { Metadata } from 'next';
import { CarteiraConta } from '@/componentes/conta/CarteiraConta';

export const metadata: Metadata = { title: 'Carteira' };

export default function PaginaCarteira() {
  return <CarteiraConta />;
}
