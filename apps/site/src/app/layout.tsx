import type { ReactNode } from 'react';
import '@/estilos/tokens.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
