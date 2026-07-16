import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Marca { id: string; nome: string; logo_url?: string; ativo: boolean; produtos: number }

export function Marcas() {
  const [dados, setDados] = useState<Marca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [editando, setEditando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Marca[]>('/admin/marcas').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = JSON.stringify({ nome });
      await (editando ? api(`/admin/marcas/${editando}`, { method: 'PUT', body }) : api('/admin/marcas', { method: 'POST', body }));
      setNome('');
      setEditando(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(m: Marca) {
    await api(`/admin/marcas/${m.id}`, { method: 'PUT', body: JSON.stringify({ nome: m.nome, ativo: !m.ativo }) });
    carregar();
  }

  return (
    <>
      <h1>Marcas</h1>
      <form className="filtros" onSubmit={salvar}>
        <input placeholder="Nome da marca" value={nome} onChange={(e) => setNome(e.target.value)} required style={{ flex: 1, maxWidth: 300 }} />
        <button className="btn">{editando ? 'Salvar edição' : 'Adicionar'}</button>
        {editando && <button type="button" className="btn btn-claro" onClick={() => { setEditando(null); setNome(''); }}>Cancelar</button>}
      </form>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Marca</th><th>Produtos</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {dados?.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.nome}</strong></td>
                <td>{m.produtos}</td>
                <td><span className={`badge ${m.ativo ? 'aprovado' : 'bloqueado'}`}>{m.ativo ? 'ativa' : 'inativa'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => { setEditando(m.id); setNome(m.nome); }}>Editar</button>{' '}
                  <button className={`btn-mini ${m.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(m)}>{m.ativo ? 'Desativar' : 'Ativar'}</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={4} className="vazio">Nenhuma marca</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
