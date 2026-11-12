'use client';

import { useState } from 'react';
import type { Imagem } from '@/lib/api/tipos';
import estilos from '@/app/p/[slug]/produto.module.css';

export function Galeria({ imagens, nome }: { imagens: Imagem[]; nome: string }) {
  const [atual, setAtual] = useState(0);
  if (imagens.length === 0) return <div className={estilos.fotoGrande}><span>Sem foto</span></div>;
  return (
    <div className={estilos.galeria}>
      <div className={estilos.fotoGrande}><img src={imagens[atual].url} alt={nome} fetchPriority="high" decoding="async" /></div>
      {imagens.length > 1 && (
        <div className={estilos.miniaturas}>
          {imagens.map((img, i) => (
            <button key={img.url} type="button" aria-label={`Ver foto ${i + 1}`} aria-pressed={i === atual}
              className={i === atual ? estilos.miniaturaAtiva : estilos.miniatura} onClick={() => setAtual(i)}>
              <img src={img.miniatura ?? img.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
