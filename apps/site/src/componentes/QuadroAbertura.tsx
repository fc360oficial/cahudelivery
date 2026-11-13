'use client';

import Link from 'next/link';
import { useSessao } from './SessaoProvider';
import estilos from './Abertura.module.css';

/** Quadro ao lado dos banners. Visitante: convite para entrar ou criar a conta. Cliente logado: boas-vindas com
 *  atalhos. O quadro existe nos dois casos para o banner não mudar de tamanho quando a sessão carrega. */
export function QuadroAbertura() {
  const { carregado, logado, nome } = useSessao();

  if (carregado && logado) {
    return (
      <aside className={estilos.convite} aria-label="Sua conta">
        <span className={estilos.sobre}>Que bom te ver de novo</span>
        <h2>Olá, <span>{nome ?? 'cliente'}</span></h2>
        <div className={estilos.acoes}>
          <Link href="/ofertas" className={estilos.primario}>Ofertas da semana</Link>
          <Link href="/carrinho" className={estilos.secundario}>Continuar meu pedido</Link>
        </div>
      </aside>
    );
  }
  return (
    <aside className={estilos.convite} aria-label="Como comprar">
      <span className={estilos.sobre}>Atacado para o seu comércio</span>
      <h2>Abasteça a sua loja <span>sem sair do balcão.</span></h2>
      <div className={estilos.acoes}>
        <Link href="/entrar" className={estilos.primario}>Já sou cliente: entrar</Link>
        <Link href="/cadastrar" className={estilos.secundario}>Quero ser cliente</Link>
      </div>
    </aside>
  );
}
