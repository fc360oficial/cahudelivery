import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtData } from '../api';

interface LinhaCliente {
  id: string;
  tipo: string;
  documento: string;
  nome_fantasia: string;
  email: string;
  telefone?: string;
  status: 'pendente' | 'aprovado' | 'bloqueado' | 'excluido';
  criado_em: string;
  pedidos: number;
}

export function Clientes() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<LinhaCliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (busca) q.set('busca', busca);
    api<{ dados: LinhaCliente[] }>(`/admin/clientes?${q}`)
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, [status, busca]);

  useEffect(carregar, [carregar]);

  async function mudar(id: string, novo: string) {
    try {
      await api(`/admin/clientes/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: novo }) });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function excluir(c: LinhaCliente) {
    const aviso = c.pedidos
      ? `${c.nome_fantasia} já tem ${c.pedidos} pedido(s). Os dados pessoais serão anonimizados (o histórico de venda é mantido por obrigação fiscal). Continuar?`
      : `Excluir ${c.nome_fantasia} definitivamente? Essa ação não pode ser desfeita.`;
    if (!confirm(aviso)) return;
    try {
      await api(`/admin/clientes/${c.id}`, { method: 'DELETE' });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <h1>Clientes</h1>
      <div className="filtros">
        <input placeholder="Buscar por nome, CNPJ ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
        {['', 'pendente', 'aprovado', 'bloqueado', 'excluido'].map((s) => (
          <button key={s || 'todos'} className={`pill-filtro ${status === s ? 'ativo' : ''}`} onClick={() => setParams(s ? { status: s } : {})}>
            {s ? s[0].toUpperCase() + s.slice(1) : 'Todos'}
          </button>
        ))}
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>Cliente</th><th>Documento</th><th>Contato</th><th>Pedidos</th><th>Status</th><th>Cadastro</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {dados?.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.nome_fantasia}</strong></td>
                <td className="mono">{c.documento}</td>
                <td>{c.email}{c.telefone ? ` · ${c.telefone}` : ''}</td>
                <td>{c.pedidos}</td>
                <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                <td>{fmtData(c.criado_em)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {c.status !== 'excluido' && (
                    <>
                      {c.status !== 'aprovado' && (
                        <button className="btn-mini btn-ok" onClick={() => mudar(c.id, 'aprovado')}>Aprovar</button>
                      )}{' '}
                      {c.status !== 'bloqueado' && (
                        <button className="btn-mini btn-perigo" onClick={() => mudar(c.id, 'bloqueado')}>Bloquear</button>
                      )}{' '}
                      <button className="btn-mini btn-perigo" onClick={() => excluir(c)}>Excluir</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={7} className="vazio">Nenhum cliente encontrado</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
