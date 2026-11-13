import Link from 'next/link';
import type { Banner } from '@/lib/api/tipos';
import { Carrossel } from './Carrossel';

/** O banner só diz o tipo e o id do destino; o slug certo sai do redirecionamento da própria página. */
function destino(b: Banner): string | null {
  if (!b.destinoId) return null;
  if (b.destinoTipo === 'produto') return `/p/produto-${b.destinoId}`;
  if (b.destinoTipo === 'categoria') return `/c/categoria-${b.destinoId}`;
  return null;
}

/** Carrossel dos banners da loja. Quem usa decide a largura (ver Abertura). */
export function Banners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <Carrossel rotulo="Destaques">
      {banners.map((b, i) => {
        const imagem = (
          <img src={b.imagemUrl} alt={b.titulo ?? ''} loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : undefined} decoding="async" />
        );
        const href = destino(b);
        return href ? <Link key={b.id} href={href}>{imagem}</Link> : <div key={b.id}>{imagem}</div>;
      })}
    </Carrossel>
  );
}
