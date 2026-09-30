import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda } from '../api';

interface ProdutoPromo { produtoId: string; nome: string; sku?: string; precoPromocional: number; imagem?: string | null }
interface Promo {
  id: string; nome: string; inicio_em: string; fim_em: string; ativo: boolean; vigente: boolean;
  produtos: ProdutoPromo[] | null;
}
/** Item elegível pra oferta: ativo + estoque no CD + foto (GET /admin/promocoes-produtos). */
interface ProdutoElegivel {
  id: string; sku: string; nome: string; unidade_venda: string; qtd_por_embalagem: string;
  categoria_id: string | null; categoria: string | null; estoque: string; preco: string | null; imagem: string | null;
}

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
  const [categoria, setCategoria] = useState('');
  const [elegiveis, setElegiveis] = useState<ProdutoElegivel[] | null>(null);

  const carregar = useCallback(() => {
    api<Promo[]>('/admin/promocoes').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  // Lista inteira dos itens que podem ir pra oferta, carregada 1x ao abrir o formulário.
  useEffect(() => {
    if (!aberto || elegiveis) return;
    api<ProdutoElegivel[]>('/admin/promocoes-produtos').then(setElegiveis).catch((e) => setErro(e.message));
  }, [aberto, elegiveis]);

  const categorias = [...new Set((elegiveis ?? []).map((p) => p.categoria ?? 'Sem categoria'))];
  const termo = busca.trim().toLowerCase();
  const visiveis = (elegiveis ?? []).filter((p) =>
    (!categoria || (p.categoria ?? 'Sem categoria') === categoria) &&
    (!termo || p.nome.toLowerCase().includes(termo) || p.sku.includes(termo)));
  const selecionado = (id: string) => itens.some((i) => i.produtoId === id);

  function alternar(p: ProdutoElegivel) {
    if (selecionado(p.id)) setItens(itens.filter((i) => i.produtoId !== p.id));
    else setItens([...itens, { produtoId: p.id, nome: p.nome, sku: p.sku, precoPromocional: Number(p.preco ?? 0), imagem: p.imagem }]);
  }

  function abrirNova() {
    setEditando(null); setNome('Ofertas da Semana'); setInicio(''); setFim(''); setItens([]); setBusca(''); setCategoria(''); setAberto(true);
  }

  function abrirEdicao(p: Promo) {
    setEditando(p.id); setNome(p.nome); setInicio(dataLocal(p.inicio_em)); setFim(dataLocal(p.fim_em));
    setItens(p.produtos ?? []); setBusca(''); setCategoria(''); setAberto(true);
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
      <h1>Ofertas da Semana</h1>
      <div className="filtros">
        <button className="btn" onClick={abrirNova}>+ Nova promoção</button>
      </div>
      {erro && <div className="erro-texto">{erro}</div>}

      {aberto && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={salvar}>
          <div className="filtros" style={{ marginBottom: 10 }}>
            <button className="btn">{editando ? 'Salvar promoção' : 'Criar promoção'}</button>
            <button type="button" className="btn btn-claro" onClick={() => setAberto(false)}>Cancelar</button>
            <span style={{ color: 'var(--texto-2)', alignSelf: 'center' }}>{itens.length} produto{itens.length === 1 ? '' : 's'} na oferta</span>
          </div>
          <div className="filtros">
            <input placeholder="Nome (ex.: Ofertas da Semana)" value={nome} onChange={(e) => setNome(e.target.value)} required style={{ flex: 1, minWidth: 220 }} />
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} required />
          </div>

          {itens.length > 0 && (
            <div className="promo-selecionados">
              <div className="rotulo">Na oferta — preço promocional por caixa</div>
              {itens.map((i, k) => (
                <div key={i.produtoId} className="promo-sel-linha">
                  {i.imagem ? <img src={i.imagem} alt="" /> : <span className="promo-sem-foto" />}
                  <span style={{ flex: 1 }}>{i.nome}</span>
                  <input type="number" step="0.01" min="0" value={i.precoPromocional}
                    onChange={(e) => setItens(itens.map((x, j) => (j === k ? { ...x, precoPromocional: Number(e.target.value) } : x)))}
                    style={{ width: 110 }} />
                  <button type="button" className="btn-mini btn-perigo" onClick={() => setItens(itens.filter((_, j) => j !== k))}>Remover</button>
                </div>
              ))}
            </div>
          )}

          <div className="rotulo" style={{ marginTop: 14 }}>Escolha os produtos (só ativos, com estoque no CD e com foto)</div>
          <div className="filtros" style={{ marginTop: 6 }}>
            <input placeholder="Filtrar por nome ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button type="button" className={`btn-mini ${categoria ? 'btn-claro' : ''}`} onClick={() => setCategoria('')}>Todas</button>
            {categorias.map((c) => (
              <button type="button" key={c} className={`btn-mini ${categoria === c ? '' : 'btn-claro'}`} onClick={() => setCategoria(c)}>{c}</button>
            ))}
          </div>
          {!elegiveis && <div className="vazio">Carregando produtos…</div>}
          {elegiveis && !visiveis.length && <div className="vazio">Nenhum produto com esse filtro</div>}
          <div className="promo-grade">
            {visiveis.map((p) => {
              const sel = selecionado(p.id);
              return (
                <div key={p.id} className={`promo-item${sel ? ' sel' : ''}`} onClick={() => alternar(p)} role="checkbox" aria-checked={sel}>
                  <span className="promo-check">{sel ? '✓' : ''}</span>
                  {p.imagem ? <img src={p.imagem} alt="" loading="lazy" /> : <span className="promo-sem-foto" />}
                  <div className="texto">
                    <div className="promo-nome">{p.nome}</div>
                    <div className="promo-sub">{p.categoria ?? 'Sem categoria'} · est. {Number(p.estoque).toLocaleString('pt-BR')}</div>
                  </div>
                  <div className="promo-preco">{p.preco ? fmtMoeda(p.preco) : 'sem preço'}</div>
                </div>
              );
            })}
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
