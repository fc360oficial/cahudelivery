'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Carrinho } from '@/lib/api/tipos';
import { deveAplicarLeitura, interpretarRespostaMutacao } from '@/lib/sessao/estado-carrinho';

interface ValorCarrinho {
  carrinho: Carrinho;
  totalVolumes: number;
  quantidadeDe: (produtoId: string) => number;
  definir: (produtoId: string, quantidade: number) => Promise<void>;
  ocupado: boolean;
  carregado: boolean;
  erro: string | null;
  recarregar: () => void;
}

const VAZIO: Carrinho = { itens: [], subtotal: 0 };

/** O servidor já apagou a sessão; o SessaoProvider (mais para dentro) escuta e volta a "Entrar". */
export const EVENTO_SESSAO_EXPIROU = 'fc:sessao-expirou';
const avisarSessaoExpirou = () => window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIROU));
const Contexto = createContext<ValorCarrinho | null>(null);

export function CarrinhoProvider({ children }: { children: ReactNode }) {
  const [carrinho, setCarrinho] = useState<Carrinho>(VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const caminho = usePathname();
  const sequencia = useRef(0); // sobe a cada mutação concluída

  const recarregar = useCallback(() => {
    const inicio = sequencia.current;
    setErro(null);
    fetch('/api/carrinho')
      .then((r) => {
        if (r.status === 401) avisarSessaoExpirou();
        return r.ok ? r.json() : Promise.reject(new Error('falha'));
      })
      .then((c: Carrinho) => {
        if (!deveAplicarLeitura(inicio, sequencia.current)) {
          // Uma mutação já trouxe um carrinho mais novo (e portanto já carregou).
          return;
        }
        setCarrinho(c);
        setCarregado(true);
      })
      .catch(() => {
        if (deveAplicarLeitura(inicio, sequencia.current)) setErro('Não foi possível carregar seu carrinho.');
      });
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const definir = useCallback(async (produtoId: string, quantidade: number) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/carrinho/itens', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId, quantidade }),
      });
      if (r.status === 401) avisarSessaoExpirou();
      const resultado = interpretarRespostaMutacao(r.ok, await r.text());
      if ('carrinho' in resultado) {
        sequencia.current += 1;
        setCarrinho(resultado.carrinho);
        setCarregado(true);
      } else {
        setErro(resultado.erro);
      }
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
    carregado,
    erro,
    recarregar,
  }), [carrinho, definir, ocupado, carregado, erro, recarregar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/* Em /carrinho, a falha de carregamento já aparece na própria página (com o botão). */}
      {erro && !(caminho === '/carrinho' && !carregado) && (
        <div role="alert" className="aviso-flutuante">
          {erro}
          {!carregado && <> <button type="button" onClick={recarregar}>Tentar de novo</button></>}
        </div>
      )}
    </Contexto.Provider>
  );
}

export function useCarrinho(): ValorCarrinho {
  const v = useContext(Contexto);
  if (!v) throw new Error('useCarrinho fora do CarrinhoProvider');
  return v;
}
