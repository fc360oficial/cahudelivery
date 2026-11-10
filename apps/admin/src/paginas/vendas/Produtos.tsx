import { useEffect, useState } from 'react';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio, formatarReais } from '../../vendas-ui';
import { Paginador, useAtraso } from './Clientes';
import './cadastros.css';

interface Produto { id: string; codigo: string | null; nome: string; categoria: string | null; estoque: number; preco: number | null; ativo: boolean }
interface Resposta { tabelas: { id: string; nome: string }[]; tabelaId: string | null; dados: Produto[]; pagina: number; total: number }

export function VendasProdutos() {
  const [tabelaId, setTabelaId] = useState('');
  const [busca, setBusca] = useState('');
  const buscaAtraso = useAtraso(busca.trim());
  const [pagina, setPagina] = useState(1);
  const [res, setRes] = useState<Resposta | null>(null);
  const [tabelas, setTabelas] = useState<{ id: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { setPagina(1); }, [tabelaId, buscaAtraso]);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (tabelaId) q.set('tabelaId', tabelaId);
    if (buscaAtraso) q.set('busca', buscaAtraso);
    setRes(null); setErro(null);
    api<Resposta>(`/admin/vendas/produtos?${q}`)
      .then((r) => {
        if (!vivo) return;
        setRes(r);
        setTabelas(r.tabelas);
        if (!tabelaId && r.tabelaId) setTabelaId(r.tabelaId);
      })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [tabelaId, buscaAtraso, pagina]);

  return (
    <>
      <CabecalhoPagina titulo="Produtos" subtitulo="Consulta de preço por tabela e estoque." />
      <p className="cad-nota">Preços e estoque vêm do ERP e não são editados aqui.</p>
      <div className="cad-filtros">
        <select aria-label="Tabela de preço" value={tabelaId} onChange={(e) => setTabelaId(e.target.value)} disabled={tabelas.length === 0}>
          {tabelas.length === 0 && <option value="">Tabela de preço</option>}
          {tabelas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        <input type="search" aria-label="Buscar produto" placeholder="Buscar por nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {erro && <div className="cad-erro">{erro}</div>}
      {!res && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : res && res.dados.length === 0 ? <Cartao><Vazio mensagem={res.tabelas.length === 0 ? 'Nenhuma tabela de preço recebida do ERP ainda. As tabelas chegam pela integração.' : 'Nenhum produto encontrado para este filtro.'} /></Cartao>
        : res && (
          <>
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas" style={{ minWidth: 760 }}>
                <thead>
                  <tr><th>Código</th><th>Produto</th><th>Categoria</th><th className="num">Estoque</th><th className="num">Preço na tabela</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {res.dados.map((p) => (
                    <tr key={p.id}>
                      <td>{p.codigo ?? '-'}</td>
                      <td><strong>{p.nome}</strong></td>
                      <td>{p.categoria ?? <span className="cad-fraco">-</span>}</td>
                      <td className="num">{p.estoque <= 0 ? <Selo variante="vermelho">Sem estoque</Selo> : p.estoque.toLocaleString('pt-BR')}</td>
                      <td className="num">{p.preco === null ? <span className="cad-fraco">sem preço</span> : formatarReais(p.preco)}</td>
                      <td><Selo variante={p.ativo ? 'verde' : 'cinza'}>{p.ativo ? 'Ativo' : 'Inativo'}</Selo></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador pagina={res.pagina} total={res.total} onMudar={setPagina} />
          </>
        )}
    </>
  );
}
