'use client';

import { useEffect, useState } from 'react';
import { precoEfetivo } from '@/lib/catalogo/preco-efetivo';
import { formatarPreco } from '@/lib/formato/preco';
import { useCarrinho } from './CarrinhoProvider';
import estilos from '@/app/p/[slug]/produto.module.css';

interface Props {
  produtoId: string;
  qtdMinima: number;
  qtdPorEmbalagem: number;
  preco: number | null;
  precoTabela: number | null;
  descontoQtdMinima: number | null;
  descontoQtdPreco: number | null;
}

export function CompraProduto(p: Props) {
  const { quantidadeDe, definir, ocupado, carregado } = useCarrinho();
  const noCarrinho = quantidadeDe(p.produtoId);
  const minimo = Math.max(1, p.qtdMinima);
  const [qtd, setQtd] = useState(minimo);
  // A API grava quantidade ABSOLUTA: nada que a envie pode ser clicado antes do carrinho carregar.
  const bloqueado = ocupado || !carregado;

  // Quando o carrinho carrega (ou muda), o seletor mostra o que já está lá.
  useEffect(() => { if (carregado && noCarrinho > 0) setQtd(noCarrinho); }, [carregado, noCarrinho]);

  const unitario = precoEfetivo(p, qtd);
  if (unitario == null) return null;

  return (
    <div className={estilos.compra}>
      <div className={estilos.compraLinha}>
        <div className={estilos.seletor}>
          <button type="button" aria-label="Diminuir quantidade" disabled={bloqueado || qtd <= minimo} onClick={() => setQtd(qtd - 1)}>−</button>
          <span aria-live="polite">{qtd}</span>
          <button type="button" aria-label="Aumentar quantidade" disabled={bloqueado} onClick={() => setQtd(qtd + 1)}>+</button>
        </div>
        <div className={estilos.totalCompra}>
          {p.qtdPorEmbalagem > 1 && <span>{qtd * p.qtdPorEmbalagem} unidades no total</span>}
          <strong>{formatarPreco(unitario * qtd)}</strong>
        </div>
      </div>
      {minimo > 1 && <p className={estilos.nota}>Quantidade mínima: {minimo}</p>}
      <button type="button" className={estilos.botaoComprar} disabled={bloqueado || qtd === noCarrinho}
        onClick={() => definir(p.produtoId, qtd)}>
        {noCarrinho === 0 ? 'Adicionar ao carrinho' : qtd === noCarrinho ? 'No carrinho' : 'Atualizar carrinho'}
      </button>
    </div>
  );
}
