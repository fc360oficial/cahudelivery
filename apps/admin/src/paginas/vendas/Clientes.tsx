import { useEffect, useState } from 'react';
import { api, fmtDocumento } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio, formatarReais, formatarDataHora, type VarianteSelo } from '../../vendas-ui';
import './cadastros.css';

const POR_PAGINA = 30;

interface Cliente {
  id: string; codigo: string | null; razaoSocial: string | null; nomeFantasia: string | null; documento: string | null; cidade: string | null;
  vendedores: string[]; limiteCredito: number | null; emAberto: number; ultimoPedidoEm: string | null; status: string;
}
interface Pagina { dados: Cliente[]; pagina: number; total: number }
interface VendedorItem { id: string; nome: string }

/** Valor com atraso curto, para não consultar a API a cada tecla. */
export function useAtraso<T>(valor: T, ms = 350): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export function Paginador({ pagina, total, onMudar }: { pagina: number; total: number; onMudar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (paginas <= 1) return null;
  return (
    <nav className="cad-pag" aria-label="Paginação">
      <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" disabled={pagina <= 1} onClick={() => onMudar(pagina - 1)}>Anterior</button>
      <span>Página {pagina} de {paginas}</span>
      <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" disabled={pagina >= paginas} onClick={() => onMudar(pagina + 1)}>Próxima</button>
    </nav>
  );
}

const SITUACAO: Record<string, [string, VarianteSelo]> = {
  aprovado: ['Aprovado', 'verde'], pendente: ['Pendente', 'amarelo'], bloqueado: ['Bloqueado', 'vermelho'], inativo: ['Inativo', 'cinza'],
};

export function VendasClientes() {
  const [vendedores, setVendedores] = useState<VendedorItem[]>([]);
  const [vendedorId, setVendedorId] = useState('');
  const [busca, setBusca] = useState('');
  const buscaAtraso = useAtraso(busca.trim());
  const [pagina, setPagina] = useState(1);
  const [res, setRes] = useState<Pagina | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<VendedorItem[]>('/admin/vendas/vendedores').then(setVendedores).catch(() => setVendedores([]));
  }, []);

  useEffect(() => { setPagina(1); }, [vendedorId, buscaAtraso]);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (vendedorId) q.set('vendedorId', vendedorId);
    if (buscaAtraso) q.set('busca', buscaAtraso);
    setRes(null); setErro(null);
    api<Pagina>(`/admin/vendas/clientes?${q}`)
      .then((r) => { if (vivo) setRes(r); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [vendedorId, buscaAtraso, pagina]);

  return (
    <>
      <CabecalhoPagina titulo="Clientes" subtitulo="Carteira de clientes dos vendedores, com limite de crédito e valores em aberto." />
      <p className="cad-nota">Aparecem aqui apenas os clientes que estão na carteira de algum vendedor.</p>
      <div className="cad-filtros">
        <select aria-label="Vendedor" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
          <option value="">Todos os vendedores</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
        </select>
        <input type="search" aria-label="Buscar cliente" placeholder="Buscar por nome, documento ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {erro && <div className="cad-erro">{erro}</div>}
      {!res && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : res && res.dados.length === 0 ? <Cartao><Vazio mensagem="Nenhum cliente encontrado para este filtro." /></Cartao>
        : res && (
          <>
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas" style={{ minWidth: 980 }}>
                <thead>
                  <tr><th>Cliente</th><th>Código</th><th>Cidade</th><th>Vendedores</th><th className="num">Limite de crédito</th><th className="num">Em aberto</th><th className="num">Disponível</th><th>Último pedido</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {res.dados.map((c) => {
                    const temLimite = c.limiteCredito !== null;
                    const disponivel = temLimite ? (c.limiteCredito as number) - c.emAberto : null;
                    const esgotado = disponivel !== null && disponivel <= 0;
                    const nome = c.razaoSocial || c.nomeFantasia || '-';
                    const [rotulo, variante] = SITUACAO[c.status] ?? [c.status, 'cinza' as VarianteSelo];
                    return (
                      <tr key={c.id}>
                        <td>
                          <strong>{nome}</strong>
                          {c.nomeFantasia && c.razaoSocial && c.nomeFantasia !== c.razaoSocial && <span className="cad-sub">{c.nomeFantasia}</span>}
                          {c.documento && <span className="cad-sub">{fmtDocumento(c.documento)}</span>}
                        </td>
                        <td>{c.codigo ?? '-'}</td>
                        <td>{c.cidade ?? '-'}</td>
                        <td>{c.vendedores.length ? c.vendedores.join(', ') : '-'}</td>
                        <td className="num">{temLimite ? formatarReais(c.limiteCredito) : <span className="cad-fraco">sem limite</span>}</td>
                        <td className="num">{formatarReais(c.emAberto)}</td>
                        <td className={`num${esgotado ? ' cad-negativo' : ''}`}>{disponivel !== null ? formatarReais(disponivel) : <span className="cad-fraco">-</span>}</td>
                        <td>{c.ultimoPedidoEm ? formatarDataHora(c.ultimoPedidoEm).slice(0, 10) : <span className="cad-fraco">sem pedidos</span>}</td>
                        <td><Selo variante={variante}>{rotulo}</Selo></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginador pagina={res.pagina} total={res.total} onMudar={setPagina} />
          </>
        )}
    </>
  );
}
