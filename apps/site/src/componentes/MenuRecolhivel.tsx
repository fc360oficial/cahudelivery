'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, type ReactNode } from 'react';

/** Fecha o menu quando a página muda (inclusive troca de filtro na mesma página). */
function FecharAoNavegar({ fechar }: { fechar: () => void }) {
  const caminho = usePathname();
  const busca = useSearchParams().toString();
  useEffect(() => { fechar(); }, [caminho, busca, fechar]);
  return null;
}

/** <details> que se comporta como menu: fecha ao escolher um item, ao clicar fora e com Esc.
 *  Sem JavaScript continua abrindo e fechando pelo próprio <summary>. */
export function MenuRecolhivel({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const fechar = useRef(() => { if (ref.current) ref.current.open = false; }).current;

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) fechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) {
        fechar();
        ref.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('click', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('click', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [fechar]);

  return (
    // Clique num link do painel fecha na hora, sem esperar a página nova chegar.
    <details ref={ref} className={className} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) fechar(); }}>
      {children}
      <Suspense fallback={null}><FecharAoNavegar fechar={fechar} /></Suspense>
    </details>
  );
}
