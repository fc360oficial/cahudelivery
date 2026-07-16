import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Banner {
  id: string; titulo?: string; imagem_url: string; destino_tipo?: string; destino_id?: string;
  ordem: number; inicio_em?: string; fim_em?: string; ativo: boolean;
}

const VAZIO = { titulo: '', imagemUrl: '', destinoTipo: '', destinoId: '', ordem: 0 };

export function Banners() {
  const [dados, setDados] = useState<Banner[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [editando, setEditando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Banner[]>('/admin/banners').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = JSON.stringify({
        titulo: form.titulo || undefined,
        imagemUrl: form.imagemUrl,
        destinoTipo: form.destinoTipo || undefined,
        destinoId: form.destinoId || undefined,
        ordem: Number(form.ordem),
      });
      await (editando ? api(`/admin/banners/${editando}`, { method: 'PUT', body }) : api('/admin/banners', { method: 'POST', body }));
      setForm(VAZIO); setEditando(null); setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(b: Banner) {
    await api(`/admin/banners/${b.id}`, {
      method: 'PUT',
      body: JSON.stringify({ titulo: b.titulo, imagemUrl: b.imagem_url, destinoTipo: b.destino_tipo ?? undefined, destinoId: b.destino_id ?? undefined, ativo: !b.ativo }),
    });
    carregar();
  }

  async function remover(id: string) {
    if (!confirm('Remover este banner?')) return;
    await api(`/admin/banners/${id}`, { method: 'DELETE' });
    carregar();
  }

  return (
    <>
      <h1>Banners</h1>
      <form className="card" style={{ marginBottom: 16 }} onSubmit={salvar}>
        <div className="filtros">
          <input placeholder="Título" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} style={{ width: 180 }} />
          <input placeholder="URL da imagem (1200x400)" value={form.imagemUrl} onChange={(e) => setForm({ ...form, imagemUrl: e.target.value })} required style={{ flex: 1, minWidth: 240 }} />
          <select value={form.destinoTipo} onChange={(e) => setForm({ ...form, destinoTipo: e.target.value })}>
            <option value="">Sem destino</option>
            <option value="promocao">Promoção</option>
            <option value="categoria">Categoria</option>
            <option value="produto">Produto</option>
            <option value="url">URL externa</option>
          </select>
          {form.destinoTipo && (
            <input placeholder="ID/URL do destino" value={form.destinoId} onChange={(e) => setForm({ ...form, destinoId: e.target.value })} style={{ width: 200 }} />
          )}
          <input type="number" title="Ordem" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} style={{ width: 80 }} />
          <button className="btn">{editando ? 'Salvar' : 'Adicionar'}</button>
          {editando && <button type="button" className="btn btn-claro" onClick={() => { setEditando(null); setForm(VAZIO); }}>Cancelar</button>}
        </div>
        <small style={{ color: 'var(--texto-2)' }}>Upload de imagem direto entra com o armazenamento de arquivos; por enquanto use uma URL pública.</small>
      </form>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Banner</th><th>Prévia</th><th>Destino</th><th>Ordem</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {dados?.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.titulo ?? '—'}</strong></td>
                <td><img src={b.imagem_url} alt="" style={{ height: 40, borderRadius: 6 }} /></td>
                <td>{b.destino_tipo ?? '—'}</td>
                <td>{b.ordem}</td>
                <td><span className={`badge ${b.ativo ? 'aprovado' : 'bloqueado'}`}>{b.ativo ? 'ativo' : 'inativo'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => { setEditando(b.id); setForm({ titulo: b.titulo ?? '', imagemUrl: b.imagem_url, destinoTipo: b.destino_tipo ?? '', destinoId: b.destino_id ?? '', ordem: b.ordem }); }}>Editar</button>{' '}
                  <button className={`btn-mini ${b.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(b)}>{b.ativo ? 'Desativar' : 'Ativar'}</button>{' '}
                  <button className="btn-mini btn-perigo" onClick={() => remover(b.id)}>Remover</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={6} className="vazio">Nenhum banner</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
