'use client';

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import estilos from './Carrossel.module.css';

const INTERVALO_MS = 7000;

/** Carrossel de banners: setas, bolinhas e troca lenta que pausa com o mouse em cima e para de vez
 *  depois que a pessoa mexe. Sem JavaScript continua rolável com o dedo (scroll-snap). */
export function Carrossel({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  const total = Children.count(children);
  const trilho = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [mexeu, setMexeu] = useState(false);

  const irPara = useCallback((indice: number) => {
    const el = trilho.current;
    if (!el) return;
    const alvo = (indice + total) % total;
    el.scrollTo({ left: alvo * el.clientWidth, behavior: 'smooth' });
    setAtual(alvo);
  }, [total]);

  useEffect(() => {
    if (total < 2 || pausado || mexeu) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => irPara(atual + 1), INTERVALO_MS);
    return () => window.clearInterval(id);
  }, [atual, irPara, mexeu, pausado, total]);

  const aoRolar = () => {
    const el = trilho.current;
    if (!el || el.clientWidth === 0) return;
    setAtual(Math.round(el.scrollLeft / el.clientWidth));
  };
  const manual = (indice: number) => { setMexeu(true); irPara(indice); };

  return (
    <section className={estilos.carrossel} aria-roledescription="carrossel" aria-label={rotulo}
      onMouseEnter={() => setPausado(true)} onMouseLeave={() => setPausado(false)}>
      <div ref={trilho} className={estilos.trilho} onScroll={aoRolar} onTouchStart={() => setMexeu(true)}>
        {Children.map(children, (filho, i) => (
          <div className={estilos.vaga} aria-roledescription="slide" aria-label={`${i + 1} de ${total}`}>{filho}</div>
        ))}
      </div>
      {total > 1 && (
        <>
          <button type="button" className={`${estilos.seta} ${estilos.anterior}`} aria-label="Banner anterior" onClick={() => manual(atual - 1)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" className={`${estilos.seta} ${estilos.proximo}`} aria-label="Próximo banner" onClick={() => manual(atual + 1)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
          </button>
          <div className={estilos.bolinhas}>
            {Array.from({ length: total }, (_, i) => (
              <button key={i} type="button" aria-label={`Ir para o banner ${i + 1}`} aria-current={i === atual ? 'true' : undefined}
                className={i === atual ? estilos.bolinhaAtiva : estilos.bolinha} onClick={() => manual(i)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
