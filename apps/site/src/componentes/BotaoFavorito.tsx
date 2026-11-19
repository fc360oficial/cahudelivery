'use client';

import estilos from './BotaoFavorito.module.css';
import { useFavoritos } from './FavoritosProvider';

/**
 * Coração de favoritar, como no app: contorno quando não está marcado, vermelho cheio quando está.
 * `variante="pagina"` é o botão com texto da página do produto; o padrão é o círculo sobre a foto.
 */
export function BotaoFavorito({ produtoId, nome, variante = 'cartao' }: { produtoId: string; nome: string; variante?: 'cartao' | 'pagina' }) {
  const { favoritado, enviando, alternar } = useFavoritos();
  const ativo = favoritado(produtoId);
  return (
    <button type="button" data-testid="botao-favorito"
      className={`${variante === 'pagina' ? estilos.pagina : estilos.cartao} ${ativo ? estilos.ativo : ''}`}
      aria-pressed={ativo} aria-label={ativo ? `Tirar ${nome} dos favoritos` : `Favoritar ${nome}`}
      disabled={enviando(produtoId)} onClick={() => alternar(produtoId)}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill={ativo ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
      {variante === 'pagina' && <span aria-hidden="true">{ativo ? 'Nos favoritos' : 'Favoritar'}</span>}
    </button>
  );
}
