'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { lerPendente, montarPendente, normalizarFavoritos } from '@/lib/favoritos/ids';
import { EVENTO_SESSAO_EXPIROU } from './CarrinhoProvider';
import { caminhoEntrar } from './conta/api-conta';
import { useSessao } from './SessaoProvider';

interface ValorFavoritos {
  favoritado: (produtoId: string) => boolean;
  /** Enquanto a marcação deste produto está indo para o servidor. */
  enviando: (produtoId: string) => boolean;
  /** Marca ou desmarca. Visitante é levado para "Entrar" e o produto é marcado quando ele volta. */
  alternar: (produtoId: string) => void;
}

const CHAVE_PENDENTE = 'fc:favoritar-ao-entrar';
const SEM_CONEXAO = 'Sem conexão. Tente novamente.';
const FALHA = 'Não foi possível salvar o favorito. Tente novamente.';
const Contexto = createContext<ValorFavoritos | null>(null);

function guardarPendente(produtoId: string) {
  try { window.sessionStorage.setItem(CHAVE_PENDENTE, montarPendente(produtoId, Date.now())); } catch { /* navegação privada: só não lembra */ }
}

function tomarPendente(): string | null {
  try {
    const texto = window.sessionStorage.getItem(CHAVE_PENDENTE);
    if (texto) window.sessionStorage.removeItem(CHAVE_PENDENTE);
    return lerPendente(texto, Date.now());
  } catch {
    return null;
  }
}

/**
 * Favoritos do cliente logado, os mesmos do app (ficam no servidor, por cliente).
 * Visitante não tem favoritos: o conjunto fica vazio até entrar.
 */
export function FavoritosProvider({ children }: { children: ReactNode }) {
  const { carregado, logado } = useSessao();
  const router = useRouter();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const [indo, setIndo] = useState<ReadonlySet<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const sequencia = useRef(0); // sobe a cada marcação concluída: leitura mais velha não passa por cima

  const gravar = useCallback(async (produtoId: string, marcar: boolean): Promise<void> => {
    setIndo((s) => new Set(s).add(produtoId));
    setErro(null);
    try {
      const r = await fetch(`/api/conta/favoritos/${produtoId}`, { method: marcar ? 'POST' : 'DELETE' });
      if (r.status === 401) {
        window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIROU));
        setErro('Sua sessão expirou. Entre novamente.');
      } else if (!r.ok) {
        setErro(FALHA);
      } else {
        sequencia.current += 1;
        setIds((s) => {
          const novo = new Set(s);
          if (marcar) novo.add(produtoId); else novo.delete(produtoId);
          return novo;
        });
      }
    } catch {
      setErro(SEM_CONEXAO);
    } finally {
      setIndo((s) => {
        const novo = new Set(s);
        novo.delete(produtoId);
        return novo;
      });
    }
  }, []);

  useEffect(() => {
    if (!carregado) return;
    if (!logado) {
      sequencia.current += 1;
      setIds(new Set());
      return;
    }
    let vivo = true;
    const inicio = sequencia.current;
    fetch('/api/conta/favoritos', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('falha'))))
      .then((bruto: unknown) => {
        if (!vivo) return;
        const lista = normalizarFavoritos(bruto);
        if (inicio === sequencia.current) setIds(new Set(lista));
        // O que o visitante tocou antes de entrar é marcado agora.
        const pendente = tomarPendente();
        if (pendente && !lista.includes(pendente)) void gravar(pendente, true);
      })
      .catch(() => { /* sem a lista os corações ficam vazios; marcar continua funcionando */ });
    return () => { vivo = false; };
  }, [carregado, logado, gravar]);

  useEffect(() => {
    if (!erro) return;
    const relogio = window.setTimeout(() => setErro(null), 5000);
    return () => window.clearTimeout(relogio);
  }, [erro]);

  const alternar = useCallback((produtoId: string) => {
    if (!carregado) return;
    if (!logado) {
      guardarPendente(produtoId);
      router.push(caminhoEntrar());
      return;
    }
    if (indo.has(produtoId)) return;
    void gravar(produtoId, !ids.has(produtoId));
  }, [carregado, logado, indo, ids, gravar, router]);

  const valor = useMemo<ValorFavoritos>(() => ({
    favoritado: (id) => ids.has(id),
    enviando: (id) => indo.has(id),
    alternar,
  }), [ids, indo, alternar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {erro && <div role="alert" className="aviso-flutuante">{erro}</div>}
    </Contexto.Provider>
  );
}

export function useFavoritos(): ValorFavoritos {
  const v = useContext(Contexto);
  if (!v) throw new Error('useFavoritos fora do FavoritosProvider');
  return v;
}
