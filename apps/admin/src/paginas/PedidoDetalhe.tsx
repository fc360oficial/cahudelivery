import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtData, fmtMoeda, STATUS_LABEL } from '../api';

interface Detalhe {
  id: string;
  numero: number;
  status: string;
  forma_pagamento: string;
  condicao_pagamento?: string;
  total: string;
  observacoes?: string;
  erp_pedido_id?: string;
  criado_em: string;
  cliente: string;
  documento: string;
  email: string;
  telefone?: string;
  endereco_snapshot_json: Record<string, string>;
  itens: { descricao: string; quantidade: string; precoUnit: string; total: string }[] | null;
  eventos: { status: string; detalhe?: string; origem: string; em: string }[] | null;
  cobranca?: { tipo: string; pix_copia_cola?: string; linha_digitavel?: string; valor: string; pago_em?: string } | null;
  nota?: { numero_nf: string } | null;
}

export function PedidoDetalhe() {
  const { id } = useParams();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);

  const carregar = useCallback(() => {
    api<Detalhe>(`/admin/pedidos/${id}`).then(setP).catch((e) => setErro(e.message));
  }, [id]);

  useEffect(carregar, [carregar]);

  async function reenviar() {
    setReenviando(true);
    try {
      await api(`/admin/pedidos/${id}/reenviar-erp`, { method: 'POST' });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setReenviando(false);
    }
  }

  if (erro) return <div className="erro-texto">{erro}</div>;
  if (!p) return <div className="vazio">Carregando…</div>;
  const end = p.endereco_snapshot_json;

  return (
    <>
      <h1>
        <Link to="/pedidos">Pedidos</Link> › Pedido #{p.numero}{' '}
        <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
      </h1>

      {p.status === 'FALHA_INTEGRACAO' && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fecaca' }}>
          <strong>Falha ao enviar para o ERP.</strong>{' '}
          <button className="btn btn-mini" onClick={reenviar} disabled={reenviando}>
            {reenviando ? 'Reenviando…' : 'Reenviar ao ERP'}
          </button>
        </div>
      )}

      <div className="grade-2">
        <div>
          <div className="tabela-wrap">
            <table>
              <thead><tr><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
              <tbody>
                {p.itens?.map((i, k) => (
                  <tr key={k}><td>{i.descricao}</td><td>{Number(i.quantidade)}</td><td>{fmtMoeda(i.precoUnit)}</td><td>{fmtMoeda(i.total)}</td></tr>
                ))}
                <tr><td colSpan={3}><strong>Total</strong></td><td><strong>{fmtMoeda(p.total)}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="rotulo">Linha do tempo</div>
            <ul className="timeline" style={{ marginTop: 12 }}>
              {p.eventos?.map((e, k) => (
                <li key={k}>
                  <strong>{STATUS_LABEL[e.status] ?? e.status}</strong> · {fmtData(e.em)} <small>({e.origem})</small>
                  {e.detalhe && <div style={{ color: 'var(--texto-2)' }}>{e.detalhe}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="rotulo">Cliente</div>
            <div style={{ marginTop: 8 }}>
              <strong>{p.cliente}</strong>
              <div className="mono">{p.documento}</div>
              <div>{p.email}</div>
              {p.telefone && <div>{p.telefone}</div>}
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="rotulo">Entrega</div>
            <div style={{ marginTop: 8 }}>
              {end.logradouro}, {end.numero} {end.complemento ?? ''}<br />
              {end.bairro} — {end.cidade}/{end.uf}<br />
              CEP {end.cep}
            </div>
            {p.observacoes && <div style={{ marginTop: 8, color: 'var(--texto-2)' }}>Obs: {p.observacoes}</div>}
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="rotulo">
              Cobrança ({p.forma_pagamento.toUpperCase()}
              {p.condicao_pagamento ? ` — ${p.condicao_pagamento}` : ''})
            </div>
            <div style={{ marginTop: 8 }}>
              {p.cobranca ? (
                <>
                  <div>{fmtMoeda(p.cobranca.valor)} {p.cobranca.pago_em ? '· ✅ pago' : '· aguardando pagamento'}</div>
                  {p.cobranca.pix_copia_cola && <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>{p.cobranca.pix_copia_cola}</div>}
                  {p.cobranca.linha_digitavel && <div className="mono" style={{ marginTop: 6 }}>{p.cobranca.linha_digitavel}</div>}
                </>
              ) : (
                <span style={{ color: 'var(--texto-2)' }}>Aguardando o ERP gerar a cobrança</span>
              )}
            </div>
            {p.nota && <div style={{ marginTop: 8 }}>NF: <span className="mono">{p.nota.numero_nf}</span></div>}
            {p.erp_pedido_id && <div style={{ marginTop: 8 }}>Pedido ERP: <span className="mono">{p.erp_pedido_id}</span></div>}
          </div>
        </div>
      </div>
    </>
  );
}
