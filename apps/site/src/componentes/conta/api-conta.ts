'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EVENTO_SESSAO_EXPIROU } from '@/componentes/CarrinhoProvider';

/**
 * As páginas de /conta são cascas: buscam os dados nas rotas /api/conta/* do próprio site
 * (o token fica no servidor). 401 = sessão vencida → avisa o cabeçalho e manda para "Entrar"
 * voltando para a página atual.
 */

const SEM_CONEXAO = 'Sem conexão. Tente novamente.';
const FALHA = 'Não foi possível carregar. Tente novamente.';

async function lerJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

function mensagemDe(corpo: unknown, padrao: string): string {
  const m = (corpo as { mensagem?: unknown } | null)?.mensagem;
  return typeof m === 'string' && m ? m : padrao;
}

export function caminhoEntrar(): string {
  return `/entrar?voltar=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

function useSessaoExpirou() {
  const router = useRouter();
  return useCallback(() => {
    window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIROU));
    router.replace(caminhoEntrar());
  }, [router]);
}

export interface Carga<T> {
  fase: 'carregando' | 'erro' | 'ok';
  dados: T | null;
  erro: string | null;
  /** Status HTTP do erro (404 = não é do cliente / não existe). */
  status: number | null;
  recarregar: () => void;
  /** Troca os dados sem buscar de novo (resposta de um PUT/POST). */
  definir: (dados: T) => void;
}

/** GET numa rota /api/conta/*, com carregando / erro / ok. */
export function useDadosConta<T>(url: string): Carga<T> {
  const expirou = useSessaoExpirou();
  const [versao, setVersao] = useState(0);
  const [estado, setEstado] = useState<Omit<Carga<T>, 'recarregar' | 'definir'>>({ fase: 'carregando', dados: null, erro: null, status: null });

  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, fase: 'carregando', erro: null, status: null }));
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const corpo = await lerJson(r);
        if (!vivo) return;
        if (r.status === 401) return expirou();
        if (!r.ok || corpo === null) setEstado({ fase: 'erro', dados: null, erro: mensagemDe(corpo, FALHA), status: r.status });
        else setEstado({ fase: 'ok', dados: corpo as T, erro: null, status: null });
      })
      .catch(() => {
        if (vivo) setEstado({ fase: 'erro', dados: null, erro: SEM_CONEXAO, status: null });
      });
    return () => { vivo = false; };
  }, [url, versao, expirou]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const definir = useCallback((dados: T) => setEstado({ fase: 'ok', dados, erro: null, status: null }), []);
  return { ...estado, recarregar, definir };
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; mensagem: string };

/** PUT/POST/DELETE numa rota /api/conta/* (o navegador manda o Origin; a rota confere). */
export function useEnviarConta() {
  const expirou = useSessaoExpirou();
  return useCallback(async <T,>(url: string, metodo: 'PUT' | 'POST' | 'DELETE', corpo?: unknown): Promise<Resultado<T>> => {
    let r: Response;
    try {
      r = await fetch(url, {
        method: metodo,
        headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      return { ok: false, mensagem: SEM_CONEXAO };
    }
    const j = await lerJson(r);
    if (r.status === 401) {
      expirou();
      return { ok: false, mensagem: mensagemDe(j, 'Sua sessão expirou. Entre novamente.') };
    }
    if (!r.ok) return { ok: false, mensagem: mensagemDe(j, 'Não foi possível concluir agora. Tente novamente.') };
    return { ok: true, dados: j as T };
  }, [expirou]);
}
