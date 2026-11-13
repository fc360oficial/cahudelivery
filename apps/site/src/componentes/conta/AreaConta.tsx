'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { SECOES_MENU, secaoAtual, VISAO_GERAL } from '@/lib/conta/secoes';
import { useSessao } from '@/componentes/SessaoProvider';
import { caminhoEntrar } from './api-conta';
import { Carregando } from './Partes';
import estilos from './Conta.module.css';

/**
 * Moldura da área do cliente: trilha, coluna lateral com o nome e o menu, conteúdo à direita.
 * Visitante (ou sessão que acabou, p.ex. depois de "Sair") vai para "Entrar" e volta aqui depois.
 */
export function AreaConta({ children }: { children: ReactNode }) {
  const { carregado, logado, nome } = useSessao();
  const caminho = usePathname();
  const router = useRouter();
  const secao = secaoAtual(caminho);

  useEffect(() => {
    if (carregado && !logado) router.replace(caminhoEntrar());
  }, [carregado, logado, router]);

  const itens = [VISAO_GERAL, ...SECOES_MENU];
  return (
    <div className={`conteudo ${estilos.area}`}>
      <nav aria-label="Você está em" className={estilos.trilha}>
        <Link href="/">Início</Link>
        <span aria-hidden="true">/</span>
        {secao && secao !== VISAO_GERAL ? (
          <>
            <Link href="/conta">Minha conta</Link>
            <span aria-hidden="true">/</span>
            <span>{secao.rotulo}</span>
          </>
        ) : (
          <span>Minha conta</span>
        )}
      </nav>
      <div className={estilos.colunas}>
        <aside className={estilos.lateral}>
          <div className={estilos.ola}>
            <span>Olá,</span>
            <strong>{nome || 'cliente'}</strong>
          </div>
          <nav aria-label="Minha conta" className={estilos.menu}>
            {itens.map((s) => {
              const atual = s.caminho === secao?.caminho;
              return (
                <Link
                  key={s.caminho}
                  href={s.caminho}
                  className={`${estilos.opcao} ${atual ? estilos.ativo : ''}`}
                  aria-current={atual ? 'page' : undefined}
                >
                  {s.rotulo}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className={estilos.conteudo}>
          {carregado && logado ? children : <Carregando />}
        </div>
      </div>
    </div>
  );
}
