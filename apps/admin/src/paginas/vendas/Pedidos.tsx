import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, formatarDataHora, formatarReais, Vazio } from '../../vendas-ui';
import { MOTIVO, SeletorVendedor, SeloStatus, useVendedores, type Divergencia } from './comum';
import './inicio-pedidos.css';

interface Linha {
  id: string;
  numero: number;
  criadoEm: string;
  cliente: string;
  clienteCodigo: string | null;
  vendedor: string | null;
  tabela: string | null;
  forma: string | null;
  total: number;
  status: string;
  divergencias: Divergencia[];
}

const ABAS = [
  ['todos', 'Todos'],
  ['retidos', 'Retidos'],
  ['liberados', 'Aguardando e no ERP'],
  ['faturados', 'Faturados'],
  ['cancelados', 'Cancelados'],
] as const;

const TAMANHO = 30;

export function VendasPedidos() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const pedida = params.get('situacao') ?? 'todos';
  const situacao = ABAS.some(([v]) => v === pedida) ? pedida : 'todos';
  const vendedorId = params.get('vendedorId') ?? '';
  const busca = params.get('busca') ?? '';
  const pagina = Math.max(1, Number(params.get('pagina')) || 1);
  const [texto, setTexto] = useState(busca);
  const vendedores = useVendedores();
  const [dados, setDados] = useState<{ dados: Linha[]; pagina: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const mudar = (novo: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novo)) {
      if (v && !(k === 'situacao' && v === 'todos') && !(k === 'pagina' && v === '1')) p.set(k, v);
      else p.delete(k);
    }
    if (!('pagina' in novo)) p.delete('pagina');
    setParams(p);
  };

  useEffect(() => {
    let vivo = true;
    setDados(null);
    const q = new URLSearchParams({ situacao, pagina: String(pagina) });
    if (vendedorId) q.set('vendedorId', vendedorId);
    if (busca) q.set('busca', busca);
    api<{ dados: Linha[]; pagina: number; total: number }>(`/admin/vendas/pedidos?${q}`)
      .then((r) => { if (vivo) { setDados(r); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message || 'Não foi possível carregar os pedidos.'); });
    return () => { vivo = false; };
  }, [situacao, vendedorId, busca, pagina]);

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;

  return (
    <>
      <CabecalhoPagina titulo="Pedidos" subtitulo="Pedidos feitos pelos vendedores no aplicativo." />

      <div className="abas-vendas" role="group" aria-label="Situação do pedido">
        {ABAS.map(([v, r]) => (
          <button key={v} type="button" className={situacao === v ? 'ativo' : ''} aria-pressed={situacao === v} onClick={() => mudar({ situacao: v })}>{r}</button>
        ))}
      </div>

      <form className="filtros-vendas" onSubmit={(e) => { e.preventDefault(); mudar({ busca: texto.trim() }); }}>
        <SeletorVendedor id="pedidos-vendedor" valor={vendedorId} onChange={(v) => mudar({ vendedorId: v })} vendedores={vendedores} />
        <input type="search" aria-label="Buscar pedido" placeholder="Buscar por nº ou cliente" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="btn-av">Buscar</button>
      </form>

      {erro && <div className="erro-vendas" role="alert">{erro}</div>}
      {!dados && !erro && <Cartao><Vazio mensagem="Carregando…" /></Cartao>}

      {dados && (
        <>
          {totalPaginas > 1 && (
            <div className="pag-vendas">
              <button type="button" className="btn-av btn-av-claro" disabled={pagina <= 1} onClick={() => mudar({ pagina: String(pagina - 1) })}>← Anterior</button>
              <span>Página {pagina} de {totalPaginas}</span>
              <button type="button" className="btn-av btn-av-claro" disabled={pagina >= totalPaginas} onClick={() => mudar({ pagina: String(pagina + 1) })}>Próxima →</button>
            </div>
          )}
          {dados.dados.length === 0 ? (
            <Cartao><Vazio mensagem="Nenhum pedido encontrado." /></Cartao>
          ) : (
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas">
                <thead>
                  <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Tabela</th><th>Forma</th><th className="num">Total</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {dados.dados.map((p) => (
                    <tr key={p.id} className="clicavel" tabIndex={0} onClick={() => nav(`/vendas/pedidos/${p.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/vendas/pedidos/${p.id}`); }}>
                      <td><strong>#{p.numero}</strong></td>
                      <td>{formatarDataHora(p.criadoEm)}</td>
                      <td>{p.cliente}{p.clienteCodigo && <span className="sub">Cód. {p.clienteCodigo}</span>}</td>
                      <td>{p.vendedor ?? '—'}</td>
                      <td>{p.tabela ?? '—'}</td>
                      <td>{p.forma ?? '—'}</td>
                      <td className="num">{formatarReais(p.total)}</td>
                      <td>
                        <SeloStatus status={p.status} />
                        {p.status === 'AGUARDANDO_VENDEDOR' && p.divergencias.length > 0 && (
                          <span className="motivos">{[...new Set(p.divergencias.map((d) => MOTIVO[d.tipo] ?? d.tipo))].join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
