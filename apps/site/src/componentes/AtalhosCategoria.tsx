import Link from 'next/link';
import type { Categoria } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';
import estilos from './AtalhosCategoria.module.css';

/** Atalhos com foto logo abaixo do banner: o caminho mais curto até o departamento. */
export function AtalhosCategoria({ categorias }: { categorias: Categoria[] }) {
  const raizes = categorias.filter((c) => !c.paiId);
  if (raizes.length === 0) return null;
  return (
    <section className={`conteudo ${estilos.secao}`} aria-label="Compre por departamento">
      <ul className={estilos.lista}>
        {raizes.map((c) => (
          <li key={c.id}>
            <Link href={caminhoCategoria(c)} className={estilos.atalho}>
              <span className={estilos.foto}>
                {c.imagemUrl
                  ? <img src={c.imagemUrl} alt="" loading="lazy" decoding="async" />
                  : <span aria-hidden="true">{c.nome.charAt(0)}</span>}
              </span>
              <span className={estilos.nome}>{c.nome}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/ofertas" className={estilos.atalho}>
            <span className={`${estilos.foto} ${estilos.fotoOferta}`} aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
            </span>
            <span className={estilos.nome}>Ofertas</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
