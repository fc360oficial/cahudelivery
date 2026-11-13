'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EVENTO_SESSAO_EXPIROU, useCarrinho } from './CarrinhoProvider';

export type ResultadoEntrada =
  | { ok: true; status: string | null }
  | { ok: false; mensagem: string; codigo?: string; erros?: Record<string, string> };

interface ValorSessao {
  carregado: boolean;
  logado: boolean;
  nome: string | null;
  status: string | null;
  entrar: (dados: { identificador: string; senha: string }) => Promise<ResultadoEntrada>;
  primeiroAcesso: (dados: { identificador: string; codigo: string; novaSenha: string }) => Promise<ResultadoEntrada>;
  /** Cadastro de cliente novo: já entra (cookies) e o carrinho do visitante passa para ele. */
  cadastrar: (dados: object) => Promise<ResultadoEntrada>;
  sair: () => Promise<boolean>;
  /** Busca de novo nome e status (depois de editar os dados cadastrais). */
  recarregar: () => Promise<void>;
}

interface EstadoSessao {
  carregado: boolean;
  logado: boolean;
  nome: string | null;
  status: string | null;
}

const INICIAL: EstadoSessao = { carregado: false, logado: false, nome: null, status: null };
const SEM_CONEXAO = 'Sem conexão. Tente novamente.';
const CADASTRO_NAO_CONCLUIDO = 'Não foi possível concluir o cadastro. Tente de novo ou fale com a distribuidora.';
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

/** Erros por campo do cadastro ({ campo: mensagem }); qualquer outra coisa é ignorada. */
function errosPorCampo(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const saida: Record<string, string> = {};
  for (const [campo, mensagem] of Object.entries(v)) if (typeof mensagem === 'string' && mensagem) saida[campo] = mensagem;
  return Object.keys(saida).length ? saida : null;
}

/** Estado "logado" vindo do navegador (GET /api/sessao), como o carrinho: as páginas seguem estáticas. */
export function SessaoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSessao>(INICIAL);
  const { recarregar: recarregarCarrinho } = useCarrinho();
  const pedido = useRef(0);

  /** Devolve true/false quando o servidor respondeu se há sessão; nulo quando não deu para saber. */
  const verificar = useCallback(async (): Promise<boolean | null> => {
    const meu = ++pedido.current;
    try {
      const r = await fetch('/api/sessao', { cache: 'no-store' });
      const j = await lerJson(r);
      const logado = r.ok ? j.logado === true : null;
      if (meu !== pedido.current) return logado;
      if (logado === true) {
        setEstado({ carregado: true, logado: true, nome: texto(j.nome), status: texto(j.status) });
      } else if (logado === false) {
        setEstado({ carregado: true, logado: false, nome: null, status: null });
      } else {
        setEstado((e) => ({ ...e, carregado: true }));
      }
      return logado;
    } catch {
      if (meu === pedido.current) setEstado((e) => ({ ...e, carregado: true }));
      return null;
    }
  }, []);

  useEffect(() => {
    void verificar();
    const aoExpirar = () => { void verificar(); };
    window.addEventListener(EVENTO_SESSAO_EXPIROU, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIROU, aoExpirar);
  }, [verificar]);

  const enviar = useCallback(async (url: string, dados: object, exigirSessao = false): Promise<ResultadoEntrada> => {
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
      const erros = errosPorCampo(j.erros);
      if (erros) resultado.erros = erros;
      return resultado;
    }
    const logado = await verificar();
    // O servidor disse que deu certo, mas não há sessão: o envio não virou conta (por exemplo, o campo
    // contra robôs foi preenchido por um preenchimento automático). Nunca mostrar sucesso nesse caso.
    if (exigirSessao && logado === false) return { ok: false, mensagem: CADASTRO_NAO_CONCLUIDO };
    recarregarCarrinho(); // o carrinho agora é o do cliente (com o do visitante somado)
    return { ok: true, status: texto(j.status) };
  }, [verificar, recarregarCarrinho]);

  const entrar = useCallback((d: { identificador: string; senha: string }) => enviar('/api/sessao', d), [enviar]);
  const primeiroAcesso = useCallback(
    (d: { identificador: string; codigo: string; novaSenha: string }) => enviar('/api/sessao/primeiro-acesso', d),
    [enviar],
  );

  const cadastrar = useCallback((d: object) => enviar('/api/sessao/cadastro', d, true), [enviar]);

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
    () => ({ ...estado, entrar, primeiroAcesso, cadastrar, sair, recarregar: async () => { await verificar(); } }),
    [estado, entrar, primeiroAcesso, cadastrar, sair, verificar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSessao fora do SessaoProvider');
  return v;
}
