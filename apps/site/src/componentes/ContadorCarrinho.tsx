'use client';

import { useCarrinho } from './CarrinhoProvider';

export function ContadorCarrinho() {
  const { totalVolumes, carregado } = useCarrinho();
  if (!carregado || totalVolumes === 0) return null;
  return (
    <span data-testid="contador-carrinho" aria-label={`${totalVolumes} volumes no carrinho`}
      style={{
        minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, background: 'var(--destaque)',
        color: 'var(--sobre-destaque)', fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {totalVolumes}
    </span>
  );
}
