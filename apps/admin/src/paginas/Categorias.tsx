import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Cat {
  id: string; pai_id?: string; nome: string; imagem_url?: string; ordem: number; ativo: boolean; produtos: number;
}

const VAZIA = { nome: '', paiId: '', ordem: 0 };

export function Categorias() {
  const [dados, setDados] = useState<Cat[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIA);
  const [editando, setEditando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Cat[]>('/admin/categorias').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = JSON.stringify({ nome: form.nome, paiId: form.paiId || undefined, ordem: Number(form.ordem) });
      await (editando
        ? api(`/admin/categorias/${editando}`, { method: 'PUT', body })
        : api('/admin/categorias', { method: 'POST', body }));
      setForm(VAZIA);
      setEditando(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(c: Cat) {
    await api(`/admin/categorias/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome: c.nome, paiId: c.pai_id ?? undefined, ativo: !c.ativo }),
    });
    carregar();
  }

  const raizes = dados?.filter((c) => !c.pai_id) ?? [];
  const filhasDe = (id: string) => dados?.filter((c) => c.pai_id === id) ?? [];

  return (
    <>
      <h1>Categorias</h1>
      <form className="filtros" onSubmit={salvar}>
        <input placeholder="Nome da categoria" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required style={{ flex: 1, maxWidth: 260 }} />
        <select value={form.paiId} onChange={(e) => setForm({ ...form, paiId: e.target.value })}>
          <option value="">(categoria principal)</option>
          {raizes.map((c) => <option key={c.id} value={c.id}>Sub de: {c.nome}</option>)}
        </select>
        <input type="number" title="Ordem" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} style={{ width: 84 }} />
        <button className="btn">{editando ? 'Salvar edição' : 'Adicionar'}</button>
        {editando && <button type="button" className="btn btn-claro" onClick={() => { setEditando(null); setForm(VAZIA); }}>Cancelar</button>}
      </form>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Categoria</th><th>Produtos</th><th>Ordem</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {raizes.flatMap((c) => [c, ...filhasDe(c.id)]).map((c) => (
              <tr key={c.id}>
                <td>{c.pai_id ? <span style={{ paddingLeft: 22, color: 'var(--texto-2)' }}>↳ {c.nome}</span> : <strong>{c.nome}</strong>}</td>
                <td>{c.produtos}</td>
                <td>{c.ordem}</td>
                <td><span className={`badge ${c.ativo ? 'aprovado' : 'bloqueado'}`}>{c.ativo ? 'ativa' : 'inativa'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => { setEditando(c.id); setForm({ nome: c.nome, paiId: c.pai_id ?? '', ordem: c.ordem }); }}>Editar</button>{' '}
                  <button className={`btn-mini ${c.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(c)}>{c.ativo ? 'Desativar' : 'Ativar'}</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={5} className="vazio">Nenhuma categoria</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
