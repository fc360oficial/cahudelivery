import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtData, fmtMoeda, sessao } from '../api';

interface Transacao {
  tid: string;
  referencia: string | null;
  status: string;
  valorAutorizado: number;
  valorCobrado: number;
  valorEstornado: number;
  disponivelEstorno: number;
  data: string | null;
  nsu: string | null;
  autorizacao: string | null;
  cartao: string | null;
  bandeira: string | null;
  estornos: { refundId: string | null; status: string; valor: number; data: string | null }[];
  pedido: { pedido_id: string; numero: number; pagamento_status: string } | null;
}

interface VendaApp {
  id: string; status: string; valor: string; valor_pago: string | null; provedor_ref: string | null; provedor_tid: string | null;
  criado_em: string; pedido_id: string; numero: number; cliente: string;
}

const STATUS_REDE: Record<string, string> = {
  Approved: 'Aprovada', Denied: 'Negada', Canceled: 'Cancelada', Pending: 'Pendente',
};

/**
 * Cartão (Rede): consulta qualquer venda do PV e cancela/estorna pela API,
 * sem entrar no portal useRede. Busca por TID (20 dígitos, aparece no
 * comprovante e no portal) ou pela referência; vendas do app vêm prontas na lista.
 */
export function RedeCartao() {
  const [busca, setBusca] = useState('');
  const [t, setT] = useState<Transacao | null>(null);
  const [vendas, setVendas] = useState<VendaApp[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const admin = sessao()?.papel === 'admin';

  useEffect(() => {
    api<VendaApp[]>('/admin/rede/vendas').then(setVendas).catch(() => setVendas([]));
  }, []);

  async function consultar(termo = busca) {
    const q = termo.trim();
    if (!q) return;
    setBusca(q); setCarregando(true); setErro(null); setOk(null); setT(null);
    try {
      const r = await api<Transacao>(`/admin/rede/transacao?busca=${encodeURIComponent(q)}`);
      setT(r);
      setValor(r.disponivelEstorno.toFixed(2));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function estornar(e: React.FormEvent) {
    e.preventDefault();
    if (!t) return;
    const v = Number(valor.replace(',', '.'));
    const oque = t.valorCobrado > 0 ? `Estornar ${fmtMoeda(v)}` : `Liberar a reserva de ${fmtMoeda(v)}`;
    if (!window.confirm(`${oque} no cartão ${t.cartao ?? ''}? Não dá pra desfazer.`)) return;
    setEnviando(true); setErro(null); setOk(null);
    try {
      const r = await api<{ mensagem: string }>(`/admin/rede/transacao/${t.tid}/estorno`, {
        method: 'POST', body: JSON.stringify({ valor: v, motivo: motivo.trim() }),
      });
      setOk(r.mensagem);
      setMotivo('');
      await consultar(t.tid);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <h1>Cartão (Rede)</h1>
      <p style={{ color: 'var(--texto-2)', marginTop: -6 }}>
        Consulte e cancele vendas no cartão sem entrar no portal da Rede. Busque pelo TID (20 dígitos) ou pela referência,
        ou escolha uma venda do app na lista.
      </p>

      <form className="filtros" onSubmit={(e) => { e.preventDefault(); consultar(); }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="TID ou referência" style={{ width: 280 }} />
        <button className="btn" disabled={carregando}>{carregando ? 'Consultando…' : 'Consultar na Rede'}</button>
      </form>

      {erro && <div className="erro-texto" style={{ marginBottom: 12 }}>{erro}</div>}
      {ok && <div style={{ color: 'var(--verde)', marginBottom: 12 }}>✓ {ok}</div>}

      {t && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 720 }}>
          <div className="rotulo">Venda na Rede</div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><th style={{ textAlign: 'left', width: 180 }}>Situação</th><td><strong>{STATUS_REDE[t.status] ?? t.status}</strong>
                {t.status === 'Approved' && t.valorCobrado === 0 && ' · só reservado (nada cobrado)'}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>Data</th><td>{t.data ? fmtData(t.data) : '—'}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>Cartão</th><td className="mono">{t.cartao ?? '—'}{t.bandeira ? ` · ${t.bandeira}` : ''}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>{t.valorCobrado > 0 ? 'Cobrado' : 'Reservado'}</th>
                <td>{fmtMoeda(t.valorCobrado > 0 ? t.valorCobrado : t.valorAutorizado)}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>Já estornado</th><td>{fmtMoeda(t.valorEstornado)}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>Identificadores</th><td className="mono" style={{ fontSize: 12 }}>
                TID {t.tid}{t.referencia ? ` · ref ${t.referencia}` : ''}{t.nsu ? ` · NSU ${t.nsu}` : ''}{t.autorizacao ? ` · aut. ${t.autorizacao}` : ''}
              </td></tr>
              <tr><th style={{ textAlign: 'left' }}>Pedido do app</th><td>
                {t.pedido ? <Link to={`/pedidos/${t.pedido.pedido_id}`}>Pedido #{t.pedido.numero}</Link> : 'Venda avulsa (fora do app)'}
              </td></tr>
            </tbody>
          </table>

          {!!t.estornos.length && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
              {t.estornos.map((e, k) => (
                <li key={k}>{e.data ? fmtData(e.data) : '—'} · {fmtMoeda(e.valor)} · {e.status}</li>
              ))}
            </ul>
          )}

          {t.disponivelEstorno > 0.009 && admin && (
            <form onSubmit={estornar} style={{ display: 'grid', gap: 8, marginTop: 14, maxWidth: 420 }}>
              <label>{t.valorCobrado > 0 ? 'Valor a estornar' : 'Valor da reserva a liberar'} (até {fmtMoeda(t.disponivelEstorno)})
                <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" style={{ width: 130, marginLeft: 8 }} />
              </label>
              <label>Motivo
                <input required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: pedido não entregue, cobrança de teste" style={{ width: '100%', marginTop: 4 }} />
              </label>
              <button className="btn btn-perigo" disabled={enviando}>
                {enviando ? 'Enviando à Rede…' : t.valorCobrado > 0 ? 'Estornar no cartão' : 'Liberar reserva'}
              </button>
            </form>
          )}
          {t.disponivelEstorno > 0.009 && !admin && (
            <div style={{ color: 'var(--texto-2)', marginTop: 10 }}>Só administradores podem estornar.</div>
          )}
        </div>
      )}

      <div className="card">
        <div className="rotulo">Vendas com cartão pelo app</div>
        {vendas === null ? <div className="vazio">Carregando…</div> : !vendas.length ? (
          <div style={{ color: 'var(--texto-2)', marginTop: 8 }}>Nenhuma venda com cartão ainda.</div>
        ) : (
          <div className="tabela-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Data</th><th>Pedido</th><th>Cliente</th><th>Valor</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {vendas.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtData(v.criado_em)}</td>
                    <td><Link to={`/pedidos/${v.pedido_id}`}>#{v.numero}</Link></td>
                    <td>{v.cliente}</td>
                    <td>{fmtMoeda(v.valor_pago ?? v.valor)}</td>
                    <td><span className={`badge pag-${v.status}`}>{v.status}</span></td>
                    <td>
                      {(v.provedor_tid || v.provedor_ref) && (
                        <button className="btn btn-mini" onClick={() => consultar(v.provedor_tid ?? v.provedor_ref ?? '')}>Ver na Rede</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
