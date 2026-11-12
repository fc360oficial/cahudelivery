'use client';

import estilos from './BotaoAdicionar.module.css';
import { useCarrinho } from './CarrinhoProvider';

export function BotaoAdicionar({ produtoId, qtdMinima, nome }: { produtoId: string; qtdMinima: number; nome: string }) {
  const { quantidadeDe, definir, ocupado, carregado } = useCarrinho();
  const qtd = quantidadeDe(produtoId);
  const bloqueado = ocupado || !carregado;
  const minimo = Math.max(1, qtdMinima);

  if (qtd === 0) {
    return (
      <button type="button" className={estilos.adicionar} disabled={bloqueado}
        aria-label={`Adicionar ${nome} ao carrinho`} onClick={() => definir(produtoId, minimo)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    );
  }
  return (
    <div className={estilos.stepper}>
      {/* Abaixo da quantidade mínima o item sai do carrinho. */}
      <button type="button" disabled={bloqueado} aria-label={`Diminuir ${nome}`}
        onClick={() => definir(produtoId, qtd - 1 < minimo ? 0 : qtd - 1)}>−</button>
      <span aria-live="polite" aria-label={`${qtd} no carrinho`}>{qtd}</span>
      <button type="button" disabled={bloqueado} aria-label={`Aumentar ${nome}`}
        onClick={() => definir(produtoId, qtd + 1)}>+</button>
    </div>
  );
}
