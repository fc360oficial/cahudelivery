'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const LIMITE_MS = 10 * 60 * 1000;

/**
 * As páginas do catálogo ficam em cache e se renovam a cada minuto, mas só quando alguém visita: a primeira
 * pessoa depois de um tempo parado recebe a versão guardada. Antes aparecia o aviso "Preços conferidos às…
 * Atualize a página" (o Tiago pediu para tirar em 19/11/2026). Agora, se a página chegou com mais de 10 minutos,
 * ela busca sozinha os dados novos, uma vez só, sem recarregar a tela nem mostrar mensagem.
 * O carrinho e o fechamento do pedido sempre usam o preço do momento, com ou sem isso.
 */
export function AtualizarPaginaAntiga({ geradoEm }: { geradoEm: number }) {
  const router = useRouter();
  const jaTentou = useRef(false);
  useEffect(() => {
    if (jaTentou.current || Date.now() - geradoEm <= LIMITE_MS) return;
    jaTentou.current = true;
    // a visita já disparou a renovação da página no servidor; um instante depois os dados novos estão prontos
    const relogio = window.setTimeout(() => router.refresh(), 2000);
    return () => window.clearTimeout(relogio);
  }, [geradoEm, router]);
  return null;
}
