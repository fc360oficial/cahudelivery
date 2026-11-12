'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EVENTO_SESSAO_EXPIROU, useCarrinho } from './CarrinhoProvider';

export type ResultadoEntrada =
  | { ok: true; status: string | null }
  | { ok: false; mensagem: string; codigo?: string };

interface ValorSessao {
  carregado: boolean;
  logado: boolean;
  nome: string | null;
  status: string | null;
  entrar: (dados: { identificador: string; senha: string }) => Promise<ResultadoEntrada>;
  primeiroAcesso: (dados: { identificador: string; codigo: string; novaSenha: string }) => Promise<ResultadoEntrada>;
  sair: () => Promise<boolean>;
}

interface EstadoSessao {
  carregado: boolean;
  logado: boolean;
  nome: string | null;
  status: string | null;
}

const INICIAL: EstadoSessao = { carregado: false, logado: false, nome: null, status: null };
const SEM_CONEXAO = 'Sem conexão. Tente novamente.';
const Contexto = createContext<ValorSessao | null>(null);

async function lerJson(r: Response): Promise<Record<string, unknown>> {
  try {
    const j: unknown = await r.json();
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const texto = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Estado "logado" vindo do navegador (GET /api/sessao), como o carrinho: as páginas seguem estáticas. */
export function SessaoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSessao>(INICIAL);
  const { recarregar: recarregarCarrinho } = useCarrinho();
  const pedido = useRef(0);

  const verificar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const r = await fetch('/api/sessao', { cache: 'no-store' });
      const j = await lerJson(r);
      if (meu !== pedido.current) return;
      if (r.ok && j.logado === true) {
        setEstado({ carregado: true, logado: true, nome: texto(j.nome), status: texto(j.status) });
      } else if (r.ok) {
        setEstado({ carregado: true, logado: false, nome: null, status: null });
      } else {
        setEstado((e) => ({ ...e, carregado: true }));
      }
    } catch {
      if (meu === pedido.current) setEstado((e) => ({ ...e, carregado: true }));
    }
  }, []);

  useEffect(() => {
    void verificar();
    const aoExpirar = () => { void verificar(); };
    window.addEventListener(EVENTO_SESSAO_EXPIROU, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIROU, aoExpirar);
  }, [verificar]);

  const enviar = useCallback(async (url: string, dados: object): Promise<ResultadoEntrada> => {
    let r: Response;
    try {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    } catch {
      return { ok: false, mensagem: SEM_CONEXAO };
    }
    const j = await lerJson(r);
    if (!r.ok) {
      const resultado: ResultadoEntrada = { ok: false, mensagem: texto(j.mensagem) ?? 'Não foi possível entrar agora. Tente novamente.' };
      const codigo = texto(j.codigo);
      if (codigo) resultado.codigo = codigo;
      return resultado;
    }
    await verificar();
    recarregarCarrinho(); // o carrinho agora é o do cliente (com o do visitante somado)
    return { ok: true, status: texto(j.status) };
  }, [verificar, recarregarCarrinho]);

  const entrar = useCallback((d: { identificador: string; senha: string }) => enviar('/api/sessao', d), [enviar]);
  const primeiroAcesso = useCallback(
    (d: { identificador: string; codigo: string; novaSenha: string }) => enviar('/api/sessao/primeiro-acesso', d),
    [enviar],
  );

  const sair = useCallback(async () => {
    try {
      const r = await fetch('/api/sessao', { method: 'DELETE' });
      if (!r.ok) return false;
    } catch {
      return false;
    }
    pedido.current += 1;
    setEstado({ carregado: true, logado: false, nome: null, status: null });
    recarregarCarrinho();
    return true;
  }, [recarregarCarrinho]);

  const valor = useMemo<ValorSessao>(
    () => ({ ...estado, entrar, primeiroAcesso, sair }),
    [estado, entrar, primeiroAcesso, sair],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSessao fora do SessaoProvider');
  return v;
}
