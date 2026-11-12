'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Carrinho } from '@/lib/api/tipos';

interface ValorCarrinho {
  carrinho: Carrinho;
  totalVolumes: number;
  quantidadeDe: (produtoId: string) => number;
  definir: (produtoId: string, quantidade: number) => Promise<void>;
  ocupado: boolean;
}

const VAZIO: Carrinho = { itens: [], subtotal: 0 };
const Contexto = createContext<ValorCarrinho | null>(null);

export function CarrinhoProvider({ children }: { children: ReactNode }) {
  const [carrinho, setCarrinho] = useState<Carrinho>(VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/carrinho')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Carrinho | null) => { if (c) setCarrinho(c); })
      .catch(() => { /* sem carrinho por enquanto; o próximo clique tenta de novo */ });
  }, []);

  const definir = useCallback(async (produtoId: string, quantidade: number) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/carrinho/itens', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId, quantidade }),
      });
      const corpo = await r.json();
      if (r.ok) setCarrinho(corpo as Carrinho);
      else setErro((corpo as { mensagem?: string }).mensagem ?? 'Não foi possível atualizar o carrinho.');
    } catch {
      setErro('Sem conexão. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }, []);

  const valor = useMemo<ValorCarrinho>(() => ({
    carrinho,
    totalVolumes: carrinho.itens.reduce((t, i) => t + i.quantidade, 0),
    quantidadeDe: (id) => carrinho.itens.find((i) => i.produtoId === id)?.quantidade ?? 0,
    definir,
    ocupado,
  }), [carrinho, definir, ocupado]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {erro && <div role="alert" className="aviso-flutuante">{erro}</div>}
    </Contexto.Provider>
  );
}

export function useCarrinho(): ValorCarrinho {
  const v = useContext(Contexto);
  if (!v) throw new Error('useCarrinho fora do CarrinhoProvider');
  return v;
}
