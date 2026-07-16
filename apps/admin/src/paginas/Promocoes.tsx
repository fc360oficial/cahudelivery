import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda } from '../api';

interface ProdutoPromo { produtoId: string; nome: string; sku?: string; precoPromocional: number }
interface Promo {
  id: string; nome: string; inicio_em: string; fim_em: string; ativo: boolean; vigente: boolean;
  produtos: ProdutoPromo[] | null;
}
interface ProdutoBusca { id: string; sku: string; nome: string; preco?: string }

const dataLocal = (iso: string) => iso.slice(0, 10);

export function Promocoes() {
  const [dados, setDados] = useState<Promo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [itens, setItens] = useState<ProdutoPromo[]>([]);
  const [busca, setBusca] = useState('');
  const [sugestoes, setSugestoes] = useState<ProdutoBusca[]>([]);

  const carregar = useCallback(() => {
    api<Promo[]>('/admin/promocoes').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  useEffect(() => {
    if (busca.length < 2) return setSugestoes([]);
    const t = setTimeout(() => {
      api<ProdutoBusca[]>(`/admin/produtos-busca?q=${encodeURIComponent(busca)}`).then(setSugestoes).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  function abrirNova() {
    setEditando(null); setNome(''); setInicio(''); setFim(''); setItens([]); setAberto(true);
  }

  function abrirEdicao(p: Promo) {
    setEditando(p.id); setNome(p.nome); setInicio(dataLocal(p.inicio_em)); setFim(dataLocal(p.fim_em));
    setItens(p.produtos ?? []); setAberto(true);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!itens.length) return setErro('Adicione ao menos um produto à promoção');
    try {
      const body = JSON.stringify({
        nome, inicioEm: `${inicio}T00:00:00-03:00`, fimEm: `${fim}T23:59:59-03:00`,
        produtos: itens.map((i) => ({ produtoId: i.produtoId, precoPromocional: Number(i.precoPromocional) })),
      });
      await (editando ? api(`/admin/promocoes/${editando}`, { method: 'PUT', body }) : api('/admin/promocoes', { method: 'POST', body }));
      setAberto(false); setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function remover(id: string) {
    if (!confirm('Remover esta promoção?')) return;
    await api(`/admin/promocoes/${id}`, { method: 'DELETE' });
    carregar();
  }

  return (
    <>
      <h1>Promoções</h1>
      <div className="filtros">
        <button className="btn" onClick={abrirNova}>+ Nova promoção</button>
      </div>
      {erro && <div className="erro-texto">{erro}</div>}

      {aberto && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={salvar}>
          <div className="filtros">
            <input placeholder="Nome (ex.: Oferta da Semana)" value={nome} onChange={(e) => setNome(e.target.value)} required style={{ flex: 1, minWidth: 220 }} />
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} required />
          </div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <input placeholder="Buscar produto para adicionar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: '100%' }} />
            {sugestoes.length > 0 && (
              <div className="card" style={{ position: 'absolute', zIndex: 5, width: '100%', padding: 6 }}>
                {sugestoes.map((s) => (
                  <div key={s.id} style={{ padding: '7px 10px', cursor: 'pointer' }}
                    onClick={() => {
                      if (!itens.some((i) => i.produtoId === s.id)) {
                        setItens([...itens, { produtoId: s.id, nome: s.nome, sku: s.sku, precoPromocional: Number(s.preco ?? 0) }]);
                      }
                      setBusca(''); setSugestoes([]);
                    }}>
                    {s.nome} <span style={{ color: 'var(--texto-2)' }}>· {s.sku} · {s.preco ? fmtMoeda(s.preco) : 'sem preço'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {itens.map((i, k) => (
            <div key={i.produtoId} className="filtros" style={{ marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{i.nome}</span>
              <input type="number" step="0.01" min="0" value={i.precoPromocional}
                onChange={(e) => setItens(itens.map((x, j) => (j === k ? { ...x, precoPromocional: Number(e.target.value) } : x)))}
                style={{ width: 120 }} />
              <button type="button" className="btn-mini btn-perigo" onClick={() => setItens(itens.filter((_, j) => j !== k))}>Remover</button>
            </div>
          ))}
          <div className="filtros" style={{ marginTop: 8 }}>
            <button className="btn">{editando ? 'Salvar promoção' : 'Criar promoção'}</button>
            <button type="button" className="btn btn-claro" onClick={() => setAberto(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Promoção</th><th>Vigência</th><th>Produtos</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.nome}</strong></td>
                <td>{dataLocal(p.inicio_em)} → {dataLocal(p.fim_em)}</td>
                <td>{p.produtos?.length ?? 0}</td>
                <td><span className={`badge ${p.vigente && p.ativo ? 'aprovado' : 'CANCELADO'}`}>{p.ativo ? (p.vigente ? 'vigente' : 'fora do período') : 'inativa'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => abrirEdicao(p)}>Editar</button>{' '}
                  <button className="btn-mini btn-perigo" onClick={() => remover(p.id)}>Remover</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={5} className="vazio">Nenhuma promoção</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
