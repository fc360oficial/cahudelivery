'use client';

import type { ReactNode } from 'react';
import { useSessao } from './SessaoProvider';

/** Mostra o conteúdo só para quem não entrou. Vem pronto do servidor (visitante é o caso comum e a
 *  página segue estática) e some quando a sessão confirma que o cliente está logado. */
export function SoVisitante({ children }: { children: ReactNode }) {
  const { carregado, logado } = useSessao();
  if (carregado && logado) return null;
  return <>{children}</>;
}
