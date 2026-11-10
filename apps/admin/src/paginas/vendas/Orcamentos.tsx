import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, formatarDataHora, formatarReais, Selo, Vazio, type VarianteSelo } from '../../vendas-ui';
import { SeletorVendedor, useVendedores } from './comum';
import './inicio-pedidos.css';

interface Linha {
  id: string;
  cliente: string;
  vendedor: string | null;
  tabela: string | null;
  forma: string | null;
  total: number;
  itens: number;
  status: string;
  pedidoNumero: number | null;
  atualizadoEm: string;
}

const TAMANHO = 30;
const SITUACAO: Record<string, [string, VarianteSelo]> = {
  aberto: ['Aberto', 'azul'],
  convertido: ['Convertido', 'verde'],
  cancelado: ['Cancelado', 'vermelho'],
};

export function VendasOrcamentos() {
  const [status, setStatus] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [pagina, setPagina] = useState(1);
  const nav = useNavigate();
  const vendedores = useVendedores();
  const [dados, setDados] = useState<{ dados: Linha[]; pagina: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (status) q.set('status', status);
    if (vendedorId) q.set('vendedorId', vendedorId);
    api<{ dados: Linha[]; pagina: number; total: number }>(`/admin/vendas/orcamentos?${q}`)
      .then((r) => { if (vivo) { setDados(r); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message || 'Não foi possível carregar os orçamentos.'); });
    return () => { vivo = false; };
  }, [status, vendedorId, pagina]);

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;

  return (
    <>
      <CabecalhoPagina titulo="Orçamentos" subtitulo="Orçamentos feitos pelos vendedores no aplicativo." />

      <div className="filtros-vendas">
        <select aria-label="Situação do orçamento" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }}>
          <option value="">Todos</option>
          <option value="aberto">Abertos</option>
          <option value="convertido">Convertidos</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <SeletorVendedor id="orc-vendedor" valor={vendedorId} onChange={(v) => { setVendedorId(v); setPagina(1); }} vendedores={vendedores} />
      </div>

      {erro && <div className="erro-vendas" role="alert">{erro}</div>}
      {!dados && !erro && <Cartao><Vazio mensagem="Carregando…" /></Cartao>}

      {dados && (
        <>
          {totalPaginas > 1 && (
            <div className="pag-vendas">
              <button type="button" className="btn-av btn-av-claro" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
              <span>Página {pagina} de {totalPaginas}</span>
              <button type="button" className="btn-av btn-av-claro" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>Próxima →</button>
            </div>
          )}
          {dados.dados.length === 0 ? (
            <Cartao><Vazio mensagem="Nenhum orçamento encontrado." /></Cartao>
          ) : (
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas">
                <thead>
                  <tr><th>Cliente</th><th>Vendedor</th><th>Tabela</th><th>Forma</th><th className="num">Itens</th><th className="num">Total</th><th>Situação</th><th>Atualizado em</th></tr>
                </thead>
                <tbody>
                  {dados.dados.map((o) => {
                    const [rotulo, variante] = SITUACAO[o.status] ?? [o.status, 'cinza' as VarianteSelo];
                    return (
                      <tr key={o.id} className="clicavel" tabIndex={0} onClick={() => nav(`/vendas/orcamentos/${o.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/vendas/orcamentos/${o.id}`); }}>
                        <td>{o.cliente}</td>
                        <td>{o.vendedor ?? '—'}</td>
                        <td>{o.tabela ?? '—'}</td>
                        <td>{o.forma ?? '—'}</td>
                        <td className="num">{o.itens}</td>
                        <td className="num">{formatarReais(o.total)}</td>
                        <td>
                          <Selo variante={variante}>{rotulo}</Selo>
                          {o.status === 'convertido' && o.pedidoNumero != null && <span className="sub">Pedido nº {o.pedidoNumero}</span>}
                        </td>
                        <td>{formatarDataHora(o.atualizadoEm)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
