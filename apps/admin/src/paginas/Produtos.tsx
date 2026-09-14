import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda, uploadCompleto } from '../api';
import { Paginacao } from '../Paginacao';

interface LinhaProduto {
  id: string;
  sku: string;
  nome: string;
  unidade_venda: string;
  ativo: boolean;
  categoria?: string;
  marca?: string;
  estoque: string;
  preco?: string;
  desconto_qtd_minima?: number;
  desconto_qtd_preco?: string;
  data_validade?: string;
  imagem_url?: string;
}

export function Produtos() {
  const [busca, setBusca] = useState('');
  const [estoque, setEstoque] = useState<'' | 'com' | 'sem'>('');
  const [imagem, setImagem] = useState<'' | 'com' | 'sem'>('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<LinhaProduto[] | null>(null);
  const [totalFiltrado, setTotalFiltrado] = useState<number | null>(null);
  const [resumo, setResumo] = useState<{ total: number; comEstoque: number; semEstoque: number; comImagem: number; semImagem: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [minimaEdit, setMinimaEdit] = useState('');
  const [precoEdit, setPrecoEdit] = useState('');
  const [validadeEdit, setValidadeEdit] = useState('');
  const [subindoId, setSubindoId] = useState<string | null>(null);

  useEffect(() => setPagina(1), [busca, estoque, imagem]);

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (busca) q.set('busca', busca);
    if (estoque) q.set('estoque', estoque);
    if (imagem) q.set('imagem', imagem);
    q.set('pagina', String(pagina));
    api<{ dados: LinhaProduto[]; totalFiltrado: number; resumo: { total: number; comEstoque: number; semEstoque: number; comImagem: number; semImagem: number } }>(`/admin/produtos?${q}`)
      .then((r) => {
        setDados(r.dados);
        setTotalFiltrado(r.totalFiltrado);
        setResumo(r.resumo);
      })
      .catch((e) => setErro(e.message));
  }, [busca, estoque, imagem, pagina]);

  useEffect(carregar, [carregar]);

  async function escolherFoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setSubindoId(id);
    try {
      const { url, urlMiniatura } = await uploadCompleto(arquivo, 'produto');
      await api(`/admin/produtos/${id}/imagem`, { method: 'PUT', body: JSON.stringify({ url, urlMiniatura }) });
      setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSubindoId(null);
      e.target.value = '';
    }
  }

  async function removerFoto(id: string) {
    if (!confirm('Remover a foto deste produto?')) return;
    try {
      await api(`/admin/produtos/${id}/imagem`, { method: 'DELETE' });
      setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(p: LinhaProduto) {
    try {
      await api(`/admin/produtos/${p.id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo: !p.ativo }) });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  function abrirEdicaoDesconto(p: LinhaProduto) {
    setEditandoId(p.id);
    setMinimaEdit(p.desconto_qtd_minima != null ? String(p.desconto_qtd_minima) : '');
    setPrecoEdit(p.desconto_qtd_preco != null ? String(p.desconto_qtd_preco) : '');
    setValidadeEdit(p.data_validade ?? '');
  }

  async function salvarDesconto(id: string) {
    const minima = minimaEdit.trim() === '' ? undefined : Number(minimaEdit);
    const preco = precoEdit.trim() === '' ? undefined : Number(precoEdit);
    if ((minima === undefined) !== (preco === undefined)) {
      return setErro('Informe quantidade mínima e preço com desconto juntos, ou deixe os dois em branco');
    }
    try {
      await api(`/admin/produtos/${id}/desconto-qtd`, {
        method: 'PATCH',
        body: JSON.stringify({ descontoQtdMinima: minima, descontoQtdPreco: preco }),
      });
      setEditandoId(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function removerDesconto(id: string) {
    try {
      await api(`/admin/produtos/${id}/desconto-qtd`, { method: 'PATCH', body: JSON.stringify({}) });
      setEditandoId(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvarValidade(id: string) {
    try {
      await api(`/admin/produtos/${id}/validade`, {
        method: 'PATCH',
        body: JSON.stringify({ dataValidade: validadeEdit.trim() || undefined }),
      });
      setEditandoId(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <h1>Produtos</h1>
      <div className="filtros">
        <input placeholder="Buscar por nome ou SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
        {([
          ['', 'Todos', resumo?.total],
          ['com', 'Com estoque', resumo?.comEstoque],
          ['sem', 'Sem estoque', resumo?.semEstoque],
        ] as const).map(([valor, rotulo, qtd]) => (
          <button key={valor || 'todos'} className={`pill-filtro ${estoque === valor ? 'ativo' : ''}`} onClick={() => setEstoque(valor)}>
            {rotulo}{qtd != null ? ` (${qtd})` : ''}
          </button>
        ))}
      </div>
      <div className="filtros" style={{ marginTop: -6, alignItems: 'center' }}>
        <span style={{ color: 'var(--texto-2)', fontSize: 12.5 }}>
          Dentro de <strong>{estoque === 'com' ? 'Com estoque' : estoque === 'sem' ? 'Sem estoque' : 'Todos'}</strong>:
        </span>
        {([
          ['com', 'Com imagem', resumo?.comImagem],
          ['sem', 'Sem imagem', resumo?.semImagem],
        ] as const).map(([valor, rotulo, qtd]) => (
          <button key={`img-${valor}`} className={`pill-filtro ${imagem === valor ? 'ativo' : ''}`}
            onClick={() => setImagem(imagem === valor ? '' : valor)}>
            {rotulo}{qtd != null ? ` (${qtd})` : ''}
          </button>
        ))}
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap tabela-wrap-fixa">
        <table className="tabela-produtos">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr><th>Foto</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por qtd.</th><th>Validade</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="foto-produto">
                    <label style={{ cursor: subindoId === p.id ? 'default' : 'pointer' }}>
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt="" style={{ width: 56, height: 56, objectFit: 'contain', background: '#fff', border: '1px solid var(--borda)', borderRadius: 8, display: 'block' }} />
                      ) : (
                        <div style={{
                          width: 56, height: 56, borderRadius: 8, background: 'var(--fundo)',
                          border: '1px dashed var(--borda)', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: 'var(--texto-2)', fontSize: 10,
                        }}>
                          {subindoId === p.id ? '…' : 'foto'}
                        </div>
                      )}
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(e) => escolherFoto(p.id, e)} disabled={subindoId === p.id}
                        style={{ display: 'none' }} />
                    </label>
                    {p.imagem_url && (
                      <button type="button" className="remover-foto" title="Remover foto"
                        onClick={() => removerFoto(p.id)}>×</button>
                    )}
                  </div>
                </td>
                <td className="col-produto">
                  <div className="nome">{p.nome}</div>
                  <div className="sub"><span className="mono">{p.sku}</span>{p.marca ? ` · ${p.marca}` : ''}</div>
                </td>
                <td>{p.categoria ?? '—'}</td>
                <td>{p.unidade_venda}</td>
                <td>{Number(p.estoque)}</td>
                <td>{p.preco ? fmtMoeda(p.preco) : '—'}</td>
                <td>
                  {editandoId === p.id ? (
                    <div className="filtros" style={{ marginBottom: 0 }}>
                      <input type="number" min="1" placeholder="A partir de" value={minimaEdit}
                        onChange={(e) => setMinimaEdit(e.target.value)} style={{ width: 90 }} />
                      <input type="number" step="0.01" min="0" placeholder="Preço" value={precoEdit}
                        onChange={(e) => setPrecoEdit(e.target.value)} style={{ width: 100 }} />
                      <button className="btn-mini btn-ok" onClick={() => salvarDesconto(p.id)}>Salvar</button>
                      <button className="btn-mini btn-claro" onClick={() => setEditandoId(null)}>Cancelar</button>
                    </div>
                  ) : p.desconto_qtd_minima != null ? (
                    <span>
                      a partir de {p.desconto_qtd_minima} un: {fmtMoeda(p.desconto_qtd_preco)}{' '}
                      <button className="btn-mini btn-claro" onClick={() => abrirEdicaoDesconto(p)}>Editar</button>{' '}
                      <button className="btn-mini btn-perigo" onClick={() => removerDesconto(p.id)}>Remover</button>
                    </span>
                  ) : (
                    <button className="btn-mini btn-claro" onClick={() => abrirEdicaoDesconto(p)}>+ Adicionar</button>
                  )}
                </td>
                <td>
                  {editandoId === p.id ? (
                    <div className="filtros" style={{ marginBottom: 0 }}>
                      <input type="date" value={validadeEdit}
                        onChange={(e) => setValidadeEdit(e.target.value)} style={{ width: 150 }} />
                      <button className="btn-mini btn-ok" onClick={() => salvarValidade(p.id)}>Salvar</button>
                    </div>
                  ) : p.data_validade ? (
                    <span>{new Date(p.data_validade).toLocaleDateString('pt-BR')}</span>
                  ) : (
                    <span style={{ color: 'var(--texto-2)' }}>—</span>
                  )}
                </td>
                <td>
                  <div className="situacao">
                  <span className={`badge ${p.ativo ? 'aprovado' : 'bloqueado'}`}>{p.ativo ? 'ativo' : 'inativo'}</span>
                  <button className={`btn-mini ${p.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(p)}>
                    {p.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                  </div>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={9} className="vazio">Nenhum produto — aguarde a sincronização do ERP</td></tr>}
          </tbody>
        </table>
      </div>
      {dados && <Paginacao pagina={pagina} qtdNaPagina={dados.length} total={totalFiltrado ?? undefined} onMudar={setPagina} />}
      <small style={{ color: 'var(--texto-2)', display: 'block', marginTop: 8 }}>
        Qualquer foto serve (celular, internet, catálogo), até 5MB: o sistema padroniza em 1000×1000 com fundo branco. Fotografe sobre fundo claro.
      </small>
    </>
  );
}
