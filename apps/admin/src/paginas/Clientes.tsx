import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtData, fmtDocumento } from '../api';
import { Paginacao } from '../Paginacao';
import { FichaCliente } from '../FichaCliente';

interface LinhaCliente {
  id: string;
  tipo: string;
  documento: string;
  nome_fantasia: string;
  email: string | null;
  telefone?: string;
  status: 'pendente' | 'aprovado' | 'bloqueado' | 'excluido';
  criado_em: string;
  pedidos: number;
  tabela_preco_id: string | null;
}

interface TabelaPreco {
  id: string; nome: string; padrao: boolean; codigo: string | null; precos: number; clientes: number;
}

/** dd/mm/aa: a data completa com hora fica no title da célula. */
function fmtDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function Clientes() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<LinhaCliente[] | null>(null);
  const [resumo, setResumo] = useState<Record<string, number> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);

  useEffect(() => setPagina(1), [status, busca]);

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (busca) q.set('busca', busca);
    q.set('pagina', String(pagina));
    api<{ dados: LinhaCliente[]; resumo: Record<string, number> }>(`/admin/clientes?${q}`)
      .then((r) => {
        setDados(r.dados);
        setResumo(r.resumo);
      })
      .catch((e) => setErro(e.message));
  }, [status, busca, pagina]);

  useEffect(carregar, [carregar]);

  const [tabelas, setTabelas] = useState<TabelaPreco[]>([]);
  useEffect(() => {
    api<TabelaPreco[]>('/admin/tabelas-preco').then(setTabelas).catch(() => setTabelas([]));
  }, []);
  const padrao = tabelas.find((t) => t.padrao);

  async function mudarTabela(id: string, tabelaPrecoId: string) {
    try {
      await api(`/admin/clientes/${id}/tabela-preco`, { method: 'PATCH', body: JSON.stringify({ tabelaPrecoId: tabelaPrecoId || null }) });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

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

  async function redefinirSenha(c: LinhaCliente) {
    if (!confirm(`Redefinir a senha de acesso de ${c.nome_fantasia}? O cliente passa a entrar com o CNPJ/CPF e a senha inicial 123456, e será obrigado a criar uma nova no próximo acesso.`)) return;
    try {
      await api(`/admin/clientes/${c.id}/redefinir-senha`, { method: 'POST' });
      alert(`Senha redefinida. Informe ao cliente: entrar com o CNPJ/CPF e a senha 123456.`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <h1>Clientes</h1>
      <div className="filtros">
        <input placeholder="Buscar por nome, CNPJ ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
        {['', 'pendente', 'aprovado', 'bloqueado', 'excluido'].map((s) => {
          const qtd = resumo?.[s || 'todos'];
          return (
            <button key={s || 'todos'} className={`pill-filtro ${status === s ? 'ativo' : ''}`} onClick={() => setParams(s ? { status: s } : {})}>
              {s ? s[0].toUpperCase() + s.slice(1) : 'Todos'}{qtd != null ? ` (${qtd})` : ''}
            </button>
          );
        })}
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table className="tabela-clientes">
          <thead>
            <tr><th>Cliente</th><th>Pedidos</th><th>Tabela de preço</th><th>Status</th><th>Cadastro</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {dados?.map((c) => (
              <tr key={c.id}>
                <td className="col-cliente">
                  <div className="nome">{c.nome_fantasia}</div>
                  <div className="sub">
                    <span className="mono">{fmtDocumento(c.documento)}</span>
                    {(c.email || c.telefone) && <span className="contato">{[c.email, c.telefone].filter(Boolean).join(' · ')}</span>}
                  </div>
                </td>
                <td>{c.pedidos}</td>
                <td>
                  {c.status === 'excluido' ? '—' : (
                    <select value={c.tabela_preco_id ?? ''} onChange={(e) => mudarTabela(c.id, e.target.value)} title="Tabela de preço que este cliente vê no app. Sem tabela = padrão.">
                      <option value="">{padrao ? `${padrao.codigo ? `${padrao.codigo} · ` : ''}${padrao.nome} (padrão)` : 'Padrão'}</option>
                      {tabelas.map((t) => (
                        <option key={t.id} value={t.id}>{t.codigo ? `${t.codigo} · ` : ''}{t.nome}{t.precos ? '' : ' (sem preços)'}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                <td title={fmtData(c.criado_em)}>{fmtDataCurta(c.criado_em)}</td>
                <td>
                  {c.status !== 'excluido' && (
                    <div className="acoes">
                      <button className="btn-mini" onClick={() => setFichaId(c.id)}>Ficha</button>
                      {c.status !== 'aprovado' && (
                        <button className="btn-mini btn-ok" onClick={() => mudar(c.id, 'aprovado')}>Aprovar</button>
                      )}
                      {c.status !== 'bloqueado' && (
                        <button className="btn-mini btn-perigo" onClick={() => mudar(c.id, 'bloqueado')}>Bloquear</button>
                      )}
                      <button className="btn-mini" onClick={() => redefinirSenha(c)}>Redefinir senha</button>
                      <button className="btn-mini btn-perigo" onClick={() => excluir(c)}>Excluir</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={6} className="vazio">Nenhum cliente encontrado</td></tr>}
          </tbody>
        </table>
      </div>
      {dados && <Paginacao pagina={pagina} qtdNaPagina={dados.length} onMudar={setPagina} />}
      {fichaId && <FichaCliente id={fichaId} onFechar={() => setFichaId(null)} />}
    </>
  );
}
