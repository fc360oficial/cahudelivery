'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCarrinho } from './CarrinhoProvider';
import { useSessao } from './SessaoProvider';
import estilos from './BarraInferior.module.css';

const ICONES = {
  inicio: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  ofertas: 'M13 2 4 14h6l-1 8 9-12h-6z',
  carrinho: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 19.5a1.2 1.2 0 1 0 0-.01M17 19.5a1.2 1.2 0 1 0 0-.01',
  conta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-4 3.6-6 8-6s8 2 8 6',
} as const;

function Icone({ nome }: { nome: keyof typeof ICONES }) {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONES[nome]} />
    </svg>
  );
}

/** Navegação fixa no pé da tela, só no celular (no computador o cabeçalho já tem tudo). */
export function BarraInferior() {
  const caminho = usePathname();
  const { totalVolumes, carregado: carrinhoCarregado } = useCarrinho();
  const { carregado, logado } = useSessao();
  const naConta = caminho.startsWith('/conta') || caminho === '/entrar' || caminho === '/cadastrar';
  const item = (ativo: boolean) => `${estilos.item} ${ativo ? estilos.ativo : ''}`;
  return (
    <nav className={estilos.barra} aria-label="Navegação principal">
      <Link href="/" className={item(caminho === '/')} aria-current={caminho === '/' ? 'page' : undefined}>
        <Icone nome="inicio" /><span>Início</span>
      </Link>
      <Link href="/ofertas" className={item(caminho === '/ofertas')} aria-current={caminho === '/ofertas' ? 'page' : undefined}>
        <Icone nome="ofertas" /><span>Ofertas</span>
      </Link>
      <Link href="/carrinho" className={item(caminho === '/carrinho' || caminho === '/finalizar')}
        aria-current={caminho === '/carrinho' ? 'page' : undefined}>
        <span className={estilos.comSelo}>
          <Icone nome="carrinho" />
          {carrinhoCarregado && totalVolumes > 0 && <span className={estilos.selo}>{totalVolumes > 99 ? '99+' : totalVolumes}</span>}
        </span>
        <span>Pedido</span>
      </Link>
      <Link href={carregado && logado ? '/conta' : '/entrar'} className={item(naConta)} aria-current={naConta ? 'page' : undefined}>
        <Icone nome="conta" /><span>{carregado && logado ? 'Conta' : 'Entrar'}</span>
      </Link>
    </nav>
  );
}
