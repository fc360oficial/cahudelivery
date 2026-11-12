import Link from 'next/link';
import type { Banner } from '@/lib/api/tipos';
import estilos from './Banners.module.css';

/** O banner só diz o tipo e o id do destino; o slug certo sai do redirecionamento da própria página. */
function destino(b: Banner): string | null {
  if (!b.destinoId) return null;
  if (b.destinoTipo === 'produto') return `/p/produto-${b.destinoId}`;
  if (b.destinoTipo === 'categoria') return `/c/categoria-${b.destinoId}`;
  return null;
}

export function Banners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className={`conteudo ${estilos.banners}`} aria-label="Destaques">
      {banners.map((b, i) => {
        const imagem = <img src={b.imagemUrl} alt={b.titulo ?? ''} loading={i === 0 ? 'eager' : 'lazy'} />;
        const href = destino(b);
        return href
          ? <Link key={b.id} href={href} className={estilos.banner}>{imagem}</Link>
          : <div key={b.id} className={estilos.banner}>{imagem}</div>;
      })}
    </div>
  );
}
