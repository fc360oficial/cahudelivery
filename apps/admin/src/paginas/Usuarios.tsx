import { useCallback, useEffect, useState } from 'react';
import { api, fmtData } from '../api';

interface Usuario { id: string; nome: string; email: string; papel: 'admin' | 'operador'; ativo: boolean; criado_em: string }

const VAZIO = { nome: '', email: '', senha: '', papel: 'operador' as 'admin' | 'operador' };

export function Usuarios() {
  const [dados, setDados] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [editando, setEditando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Usuario[]>('/admin/usuarios').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = JSON.stringify({ nome: form.nome, email: form.email, papel: form.papel, senha: form.senha || undefined });
      await (editando ? api(`/admin/usuarios/${editando}`, { method: 'PUT', body }) : api('/admin/usuarios', { method: 'POST', body }));
      setForm(VAZIO); setEditando(null); setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(u: Usuario) {
    await api(`/admin/usuarios/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome: u.nome, email: u.email, papel: u.papel, ativo: !u.ativo }),
    });
    carregar();
  }

  return (
    <>
      <h1>Usuários da retaguarda</h1>
      <form className="filtros" onSubmit={salvar}>
        <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required style={{ width: 170 }} />
        <input type="email" placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required style={{ flex: 1, maxWidth: 240 }} />
        <input type="password" placeholder={editando ? 'Nova senha (opcional)' : 'Senha (mín. 8)'} value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} style={{ width: 170 }} />
        <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value as 'admin' | 'operador' })}>
          <option value="operador">Operador</option>
          <option value="admin">Administrador</option>
        </select>
        <button className="btn">{editando ? 'Salvar' : 'Adicionar'}</button>
        {editando && <button type="button" className="btn btn-claro" onClick={() => { setEditando(null); setForm(VAZIO); }}>Cancelar</button>}
      </form>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Criado</th><th></th></tr></thead>
          <tbody>
            {dados?.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.nome}</strong></td>
                <td>{u.email}</td>
                <td><span className={`badge ${u.papel === 'admin' ? 'FATURADO' : 'RECEBIDO'}`}>{u.papel}</span></td>
                <td><span className={`badge ${u.ativo ? 'aprovado' : 'bloqueado'}`}>{u.ativo ? 'ativo' : 'inativo'}</span></td>
                <td>{fmtData(u.criado_em)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => { setEditando(u.id); setForm({ nome: u.nome, email: u.email, senha: '', papel: u.papel }); }}>Editar</button>{' '}
                  <button className={`btn-mini ${u.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(u)}>{u.ativo ? 'Desativar' : 'Ativar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small style={{ color: 'var(--texto-2)' }}>Criar/editar usuários e mudar configurações exige papel de administrador.</small>
    </>
  );
}
