'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useSessao } from './SessaoProvider';
import estilos from './BotaoConta.module.css';

function IconePessoa() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

/** "Entrar" para o visitante; "Olá, <nome>" com menu "Sair" para o cliente. Fica entre a busca e o carrinho. */
export function BotaoConta() {
  const { carregado, logado, nome, sair } = useSessao();
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [erro, setErro] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  // Reserva o espaço até saber quem é: sem pulo de layout.
  if (!carregado) return <span className={`${estilos.conta} ${estilos.reserva}`} aria-hidden="true" />;

  if (!logado) {
    const voltar = caminho && caminho !== '/' && caminho !== '/entrar' ? `?voltar=${encodeURIComponent(caminho)}` : '';
    return (
      <Link href={`/entrar${voltar}`} className={estilos.conta}>
        <IconePessoa />
        <span className={estilos.rotulo}>Entrar</span>
      </Link>
    );
  }

  const aoSair = async () => {
    setSaindo(true);
    setErro(false);
    const ok = await sair();
    setSaindo(false);
    if (ok) setAberto(false);
    else setErro(true);
  };

  return (
    <div className={estilos.caixa} ref={caixa}>
      <button
        type="button"
        className={estilos.conta}
        aria-expanded={aberto}
        aria-controls={idMenu}
        onClick={() => setAberto((a) => !a)}
        title={nome ?? undefined}
      >
        <IconePessoa />
        <span className={`${estilos.rotulo} ${estilos.nome}`}>Olá, {nome || 'cliente'}</span>
      </button>
      {aberto && (
        <div id={idMenu} className={estilos.menu}>
          <button type="button" onClick={aoSair} disabled={saindo}>{saindo ? 'Saindo…' : 'Sair'}</button>
          {erro && <p role="alert">Não foi possível sair. Tente novamente.</p>}
        </div>
      )}
    </div>
  );
}
