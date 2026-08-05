import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda, upload } from '../api';

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
  const [dados, setDados] = useState<LinhaProduto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [minimaEdit, setMinimaEdit] = useState('');
  const [precoEdit, setPrecoEdit] = useState('');
  const [validadeEdit, setValidadeEdit] = useState('');
  const [subindoId, setSubindoId] = useState<string | null>(null);

  const carregar = useCallback(() => {
    const q = busca ? `?busca=${encodeURIComponent(busca)}` : '';
    api<{ dados: LinhaProduto[] }>(`/admin/produtos${q}`)
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, [busca]);

  useEffect(carregar, [carregar]);

  async function escolherFoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setSubindoId(id);
    try {
      const url = await upload(arquivo);
      await api(`/admin/produtos/${id}/imagem`, { method: 'PUT', body: JSON.stringify({ url }) });
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
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>Foto</th><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por quantidade</th><th>Validade</th><th>Situação</th><th></th></tr>
          </thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <label style={{ cursor: subindoId === p.id ? 'default' : 'pointer' }}>
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: 6, background: 'var(--fundo)',
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
                      <button type="button" className="btn-mini btn-perigo" title="Remover foto"
                        onClick={() => removerFoto(p.id)}>×</button>
                    )}
                  </div>
                </td>
                <td className="mono">{p.sku}</td>
                <td><strong>{p.nome}</strong>{p.marca ? <span style={{ color: 'var(--texto-2)' }}> · {p.marca}</span> : null}</td>
                <td>{p.categoria ?? '—'}</td>
                <td>{p.unidade_venda}</td>
                <td>{Number(p.estoque)}</td>
                <td>{p.preco ? fmtMoeda(p.preco) : '—'}</td>
                <td>
                  {editandoId === p.id ? (
                    <div className="filtros" style={{ flexWrap: 'nowrap' }}>
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
                    <div className="filtros" style={{ flexWrap: 'nowrap' }}>
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
                <td><span className={`badge ${p.ativo ? 'aprovado' : 'bloqueado'}`}>{p.ativo ? 'ativo' : 'inativo'}</span></td>
                <td>
                  <button className={`btn-mini ${p.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(p)}>
                    {p.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={11} className="vazio">Nenhum produto — aguarde a sincronização do ERP</td></tr>}
          </tbody>
        </table>
      </div>
      <small style={{ color: 'var(--texto-2)', display: 'block', marginTop: 8 }}>
        Foto quadrada, ideal 800×800, até 5MB (PNG/JPG/WEBP).
      </small>
    </>
  );
}
