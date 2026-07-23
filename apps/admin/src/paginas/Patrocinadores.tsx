import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda, upload } from '../api';

interface ProdutoPatro { produtoId: string; nome: string; sku?: string; precoEspecial?: number }
interface Patrocinador {
  id: string; nome: string; logo_url?: string; banner_url?: string;
  apos_categoria_id?: string; apos_categoria_nome?: string; ativo: boolean;
  produtos: ProdutoPatro[] | null;
}
interface Categoria { id: string; nome: string; pai_id?: string }
interface ProdutoBusca { id: string; sku: string; nome: string; preco?: string }

const VAZIO = { nome: '', logoUrl: '', bannerUrl: '', aposCategoriaId: '' };

export function Patrocinadores() {
  const [dados, setDados] = useState<Patrocinador[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [itens, setItens] = useState<ProdutoPatro[]>([]);
  const [busca, setBusca] = useState('');
  const [sugestoes, setSugestoes] = useState<ProdutoBusca[]>([]);
  const [subindoLogo, setSubindoLogo] = useState(false);
  const [subindoBanner, setSubindoBanner] = useState(false);

  const carregar = useCallback(() => {
    api<Patrocinador[]>('/admin/patrocinadores').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    api<Categoria[]>('/admin/categorias').then(setCategorias).catch(() => {});
  }, []);

  useEffect(() => {
    if (busca.length < 2) return setSugestoes([]);
    const t = setTimeout(() => {
      api<ProdutoBusca[]>(`/admin/produtos-busca?q=${encodeURIComponent(busca)}`).then(setSugestoes).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  function abrirNovo() {
    setEditando(null); setForm(VAZIO); setItens([]); setAberto(true);
  }

  function abrirEdicao(p: Patrocinador) {
    setEditando(p.id);
    setForm({ nome: p.nome, logoUrl: p.logo_url ?? '', bannerUrl: p.banner_url ?? '', aposCategoriaId: p.apos_categoria_id ?? '' });
    setItens(p.produtos ?? []);
    setAberto(true);
  }

  async function escolherArquivo(campo: 'logoUrl' | 'bannerUrl', setSubindo: (v: boolean) => void, e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setSubindo(true);
    try {
      const url = await upload(arquivo);
      setForm((f) => ({ ...f, [campo]: url }));
      setErro(null);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSubindo(false);
      e.target.value = '';
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!itens.length) return setErro('Adicione ao menos um produto ao patrocinador');
    try {
      const body = JSON.stringify({
        nome: form.nome,
        logoUrl: form.logoUrl || undefined,
        bannerUrl: form.bannerUrl || undefined,
        aposCategoriaId: form.aposCategoriaId || undefined,
        produtos: itens.map((i) => ({
          produtoId: i.produtoId,
          precoEspecial: i.precoEspecial != null && `${i.precoEspecial}` !== '' ? Number(i.precoEspecial) : undefined,
        })),
      });
      await (editando ? api(`/admin/patrocinadores/${editando}`, { method: 'PUT', body }) : api('/admin/patrocinadores', { method: 'POST', body }));
      setAberto(false); setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(p: Patrocinador) {
    await api(`/admin/patrocinadores/${p.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        nome: p.nome, logoUrl: p.logo_url ?? undefined, bannerUrl: p.banner_url ?? undefined,
        aposCategoriaId: p.apos_categoria_id ?? undefined, ativo: !p.ativo,
        produtos: (p.produtos ?? []).map((i) => ({ produtoId: i.produtoId, precoEspecial: i.precoEspecial ?? undefined })),
      }),
    });
    carregar();
  }

  async function remover(id: string) {
    if (!confirm('Remover este patrocinador?')) return;
    await api(`/admin/patrocinadores/${id}`, { method: 'DELETE' });
    carregar();
  }

  return (
    <>
      <h1>Patrocinadores</h1>
      <div className="filtros">
        <button className="btn" onClick={abrirNovo}>+ Novo patrocinador</button>
      </div>
      {erro && <div className="erro-texto">{erro}</div>}

      {aberto && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={salvar}>
          <div className="filtros">
            <input placeholder="Nome (ex.: M.Dias Alimentos)" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required style={{ flex: 1, minWidth: 220 }} />
            <select value={form.aposCategoriaId} onChange={(e) => setForm({ ...form, aposCategoriaId: e.target.value })}>
              <option value="">Aparece no topo, antes de tudo</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>Depois de: {c.nome}</option>)}
            </select>
          </div>
          <div className="filtros" style={{ marginTop: 8 }}>
            <label className="btn btn-claro">
              {subindoLogo ? 'Enviando…' : '📁 Logo (redondo)'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => escolherArquivo('logoUrl', setSubindoLogo, e)} style={{ display: 'none' }} />
            </label>
            {form.logoUrl && <img src={form.logoUrl} alt="" style={{ height: 38, width: 38, borderRadius: '50%', objectFit: 'cover' }} />}
            <label className="btn btn-claro">
              {subindoBanner ? 'Enviando…' : '📁 Banner (1400x400)'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => escolherArquivo('bannerUrl', setSubindoBanner, e)} style={{ display: 'none' }} />
            </label>
            {form.bannerUrl && <img src={form.bannerUrl} alt="" style={{ height: 38, borderRadius: 6 }} />}
          </div>
          <div style={{ position: 'relative', margin: '10px 0' }}>
            <input placeholder="Buscar produto para adicionar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: '100%' }} />
            {sugestoes.length > 0 && (
              <div className="card" style={{ position: 'absolute', zIndex: 5, width: '100%', padding: 6 }}>
                {sugestoes.map((s) => (
                  <div key={s.id} style={{ padding: '7px 10px', cursor: 'pointer' }}
                    onClick={() => {
                      if (!itens.some((i) => i.produtoId === s.id)) {
                        setItens([...itens, { produtoId: s.id, nome: s.nome, sku: s.sku }]);
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
              <input type="number" step="0.01" min="0" placeholder="Preço especial (opcional)" value={i.precoEspecial ?? ''}
                onChange={(e) => setItens(itens.map((x, j) => (j === k ? { ...x, precoEspecial: e.target.value === '' ? undefined : Number(e.target.value) } : x)))}
                style={{ width: 180 }} />
              <button type="button" className="btn-mini btn-perigo" onClick={() => setItens(itens.filter((_, j) => j !== k))}>Remover</button>
            </div>
          ))}
          <div className="filtros" style={{ marginTop: 8 }}>
            <button className="btn">{editando ? 'Salvar patrocinador' : 'Criar patrocinador'}</button>
            <button type="button" className="btn btn-claro" onClick={() => setAberto(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Patrocinador</th><th>Aparece depois de</th><th>Produtos</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.nome}</strong></td>
                <td>{p.apos_categoria_nome ?? 'Topo'}</td>
                <td>{p.produtos?.length ?? 0}</td>
                <td><span className={`badge ${p.ativo ? 'aprovado' : 'bloqueado'}`}>{p.ativo ? 'ativo' : 'inativo'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => abrirEdicao(p)}>Editar</button>{' '}
                  <button className={`btn-mini ${p.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(p)}>{p.ativo ? 'Desativar' : 'Ativar'}</button>{' '}
                  <button className="btn-mini btn-perigo" onClick={() => remover(p.id)}>Remover</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={5} className="vazio">Nenhum patrocinador</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}