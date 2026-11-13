import type { Metadata } from 'next';
import { CreditoConta } from '@/componentes/conta/CreditoConta';

export const metadata: Metadata = { title: 'Crédito' };

export default function PaginaCredito() {
  return <CreditoConta />;
}
