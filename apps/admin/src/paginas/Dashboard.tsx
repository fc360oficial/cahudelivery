import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtMoeda, STATUS_LABEL } from '../api';

interface DadosDashboard {
  hoje: { pedidos: number; faturamento: string };
  ultimos30d: { pedidos: number; faturamento: string; ticket_medio: string };
  porStatus: { status: string; qtd: number }[];
  topProdutos: { produto: string; qtd: string; valor: string }[];
  clientesPendentes: number;
  falhasIntegracao: number;
}

export function Dashboard() {
  const [d, setD] = useState<DadosDashboard | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<DadosDashboard>('/admin/dashboard').then(setD).catch((e) => setErro(e.message));
  }, []);

  if (erro) return <div className="erro-texto">{erro}</div>;
  if (!d) return <div className="vazio">Carregando…</div>;

  return (
    <>
      <h1>Dashboard</h1>
      <div className="kpis">
        <div className="card"><div className="rotulo">Pedidos hoje</div><div className="valor">{d.hoje.pedidos}</div></div>
        <div className="card"><div className="rotulo">Faturamento hoje</div><div className="valor">{fmtMoeda(d.hoje.faturamento)}</div></div>
        <div className="card"><div className="rotulo">Faturamento 30 dias</div><div className="valor">{fmtMoeda(d.ultimos30d.faturamento)}</div></div>
        <div className="card"><div className="rotulo">Ticket médio 30d</div><div className="valor">{fmtMoeda(d.ultimos30d.ticket_medio)}</div></div>
        <Link to="/clientes?status=pendente" className="card">
          <div className="rotulo">Clientes p/ aprovar</div>
          <div className={`valor ${d.clientesPendentes ? 'alerta' : ''}`}>{d.clientesPendentes}</div>
        </Link>
        <Link to="/pedidos?status=FALHA_INTEGRACAO" className="card">
          <div className="rotulo">Falhas integração</div>
          <div className={`valor ${d.falhasIntegracao ? 'erro' : ''}`}>{d.falhasIntegracao}</div>
        </Link>
      </div>

      <div className="grade-2">
        <div className="tabela-wrap">
          <table>
            <thead><tr><th>Produtos mais vendidos (30d)</th><th>Qtd</th><th>Valor</th></tr></thead>
            <tbody>
              {d.topProdutos.map((p) => (
                <tr key={p.produto}><td>{p.produto}</td><td>{Number(p.qtd)}</td><td>{fmtMoeda(p.valor)}</td></tr>
              ))}
              {!d.topProdutos.length && <tr><td colSpan={3} className="vazio">Sem vendas no período</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="tabela-wrap">
          <table>
            <thead><tr><th>Pedidos por status</th><th></th></tr></thead>
            <tbody>
              {d.porStatus.map((s) => (
                <tr key={s.status}>
                  <td><span className={`badge ${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                  <td>{s.qtd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
