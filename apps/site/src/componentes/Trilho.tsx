'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import estilos from './Trilho.module.css';

/** Fileira de produtos da vitrine: rola com o dedo no celular e ganha setas no computador. */
export function Trilho({ children, rotulo, porLinha }: { children: ReactNode; rotulo: string; porLinha?: number }) {
  const trilho = useRef<HTMLDivElement>(null);
  const [inicio, setInicio] = useState(true);
  const [fim, setFim] = useState(false);

  const medir = useCallback(() => {
    const el = trilho.current;
    if (!el) return;
    setInicio(el.scrollLeft <= 4);
    setFim(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  const rolar = (sentido: 1 | -1) => {
    const el = trilho.current;
    if (el) el.scrollBy({ left: sentido * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div className={estilos.moldura} style={porLinha ? ({ '--por-linha': porLinha } as CSSProperties) : undefined}>
      <div ref={trilho} className={estilos.trilho} onScroll={medir}>{children}</div>
      {!inicio && (
        <button type="button" className={`${estilos.seta} ${estilos.anterior}`} aria-label={`Voltar em ${rotulo}`} onClick={() => rolar(-1)}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      )}
      {!fim && (
        <button type="button" className={`${estilos.seta} ${estilos.proximo}`} aria-label={`Ver mais de ${rotulo}`} onClick={() => rolar(1)}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  );
}
