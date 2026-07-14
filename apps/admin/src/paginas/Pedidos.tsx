import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtData, fmtMoeda, STATUS_LABEL } from '../api';

interface LinhaPedido {
  id: string;
  numero: number;
  status: string;
  forma_pagamento: string;
  total: string;
  erp_pedido_id?: string;
  criado_em: string;
  cliente: string;
  documento: string;
}

export function Pedidos() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<LinhaPedido[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (busca) q.set('busca', busca);
    api<{ dados: LinhaPedido[] }>(`/admin/pedidos?${q}`)
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, [status, busca]);

  return (
    <>
      <h1>Pedidos</h1>
      <div className="filtros">
        <input placeholder="Buscar por nº, cliente ou CNPJ…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
        {['', 'RECEBIDO', 'ENVIADO_ERP', 'FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE', 'FALHA_INTEGRACAO'].map((s) => (
          <button
            key={s || 'todos'}
            className={`pill-filtro ${status === s ? 'ativo' : ''}`}
            onClick={() => setParams(s ? { status: s } : {})}
          >
            {s ? STATUS_LABEL[s] : 'Todos'}
          </button>
        ))}
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>Nº</th><th>Cliente</th><th>Status</th><th>Pagamento</th><th>Total</th><th>ERP</th><th>Data</th></tr>
          </thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id} className="clicavel" onClick={() => nav(`/pedidos/${p.id}`)}>
                <td><strong>#{p.numero}</strong></td>
                <td>{p.cliente}</td>
                <td><span className={`badge ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                <td>{p.forma_pagamento.toUpperCase()}</td>
                <td>{fmtMoeda(p.total)}</td>
                <td className="mono">{p.erp_pedido_id ?? '—'}</td>
                <td>{fmtData(p.criado_em)}</td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={7} className="vazio">Nenhum pedido encontrado</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
