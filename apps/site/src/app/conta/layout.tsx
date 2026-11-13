import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AreaConta } from '@/componentes/conta/AreaConta';

// Área pessoal: nunca indexada, nunca em cache. Os dados vêm das rotas /api/conta/* no navegador
// (cookies só podem ser gravados em route handlers, e a renovação do token grava cookie).
export const metadata: Metadata = {
  title: 'Minha conta',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default function LayoutConta({ children }: { children: ReactNode }) {
  return <AreaConta>{children}</AreaConta>;
}
