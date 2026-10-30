import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiForm, apiImagem, fmtData, fmtDocumento, fmtMoeda, PAGAMENTO_LABEL, sessao, STATUS_LABEL } from '../api';

const PAGAMENTO_STATUS_LABEL: Record<string, string> = {
  pendente: 'Aguardando', pago: 'Pago', expirado: 'Expirado', cancelado: 'Cancelado', falhou: 'Falhou',
  estorno_solicitado: 'Estorno solicitado', estornado: 'Estornado',
};

/** returnCode do 3DS da Rede → texto curto pra quem confere o pagamento. */
export const AUTENTICACAO_3DS: Record<string, string> = {
  '200': 'Autenticado no banco (3DS) ✅',
  '201': 'Banco dispensou a autenticação',
  '202': 'Não autenticado',
  '203': '3DS não contratado na Rede',
  '204': 'Cartão sem autenticação no banco',
  '220': 'Aguardando o cliente autenticar no banco',
};

const ESTORNO_STATUS_LABEL: Record<string, string> = { solicitado: 'Solicitado (D+1)', concluido: 'Concluído', falhou: 'Falhou' };

/** Foto de rota autenticada (comprovante de entrega não é público). */
function FotoProtegida({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let blob: string | null = null;
    apiImagem(path).then((u) => { blob = u; setUrl(u); }).catch((e) => setErro(e.message));
    return () => { if (blob) URL.revokeObjectURL(blob); };
  }, [path]);
  if (erro) return <div style={{ color: 'var(--texto-2)' }}>{erro}</div>;
  if (!url) return <div style={{ color: 'var(--texto-2)' }}>Carregando foto…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, border: '1px solid #e5e7eb', marginTop: 6 }} />
    </a>
  );
}

/**
 * Comprovante de entrega (pensado pro celular do motorista): nome e documento
 * de quem recebeu, foto do canhoto assinado (abre a câmera), foto da entrega e GPS.
 */
function RegistrarEntrega({ pedidoId, onPronto, refazer }: { pedidoId: string; onPronto: () => void; refazer: boolean }) {
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [obs, setObs] = useState('');
  const [canhoto, setCanhoto] = useState<File | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setGpsMsg('Localização não autorizada — o comprovante vai sem GPS'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!canhoto && !refazer) { setErro('Tire a foto do canhoto assinado'); return; }
    setEnviando(true); setErro(null);
    const fd = new FormData();
    fd.append('recebedorNome', nome.trim());
    if (documento.trim()) fd.append('recebedorDocumento', documento.trim());
    if (obs.trim()) fd.append('observacao', obs.trim());
    if (gps) { fd.append('latitude', String(gps.lat)); fd.append('longitude', String(gps.lng)); }
    if (canhoto) fd.append('canhoto', canhoto);
    if (foto) fd.append('foto', foto);
    try {
      await apiForm(`/admin/pedidos/${pedidoId}/entrega`, fd);
      onPronto();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} style={{ display: 'grid', gap: 10, marginTop: 10 }}>
      <label>Quem recebeu (nome legível)
        <input required minLength={2} value={nome} onChange={(e) => setNome(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <label>Documento de quem recebeu (RG ou CPF)
        <input value={documento} onChange={(e) => setDocumento(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <label>Foto do canhoto assinado {refazer ? '(deixe vazio para manter a atual)' : '(obrigatória)'}
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setCanhoto(e.target.files?.[0] ?? null)} style={{ marginTop: 4 }} />
      </label>
      <label>Foto da entrega (mercadoria na porta / fachada) — opcional
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} style={{ marginTop: 4 }} />
      </label>
      <label>Observação
        <input value={obs} onChange={(e) => setObs(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <div style={{ color: 'var(--texto-2)', fontSize: 12.5 }}>
        {gps ? `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : gpsMsg ?? 'Pegando a localização…'}
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <button className="btn" disabled={enviando}>{enviando ? 'Enviando…' : 'Confirmar entrega'}</button>
    </form>
  );
}

/** Estorno do cartão: total (padrão) ou parcial, com motivo. Só papel admin. */
function EstornarCartao({ pedidoId, disponivel, onPronto }: { pedidoId: string; disponivel: number; onPronto: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(disponivel.toFixed(2));
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor.replace(',', '.'));
    if (!window.confirm(`Estornar ${fmtMoeda(v)} no cartão do cliente? Não dá para desfazer.`)) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await api<{ status: string; mensagem: string }>(`/admin/pedidos/${pedidoId}/estorno`, {
        method: 'POST',
        body: JSON.stringify({ valor: v, motivo: motivo.trim() }),
      });
      setMsg({ ok: true, texto: r.mensagem });
      setAberto(false);
      onPronto();
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-mini btn-perigo" onClick={() => setAberto(true)}>Estornar no cartão</button>
        {msg && <span className={msg.ok ? '' : 'erro-texto'} style={{ marginLeft: 10, color: msg.ok ? 'var(--verde)' : undefined }}>{msg.texto}</span>}
      </div>
    );
  }
  return (
    <form onSubmit={enviar} style={{ display: 'grid', gap: 8, marginTop: 12, maxWidth: 380 }}>
      <label>Valor (até {fmtMoeda(disponivel)})
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" style={{ width: 140, marginLeft: 8 }} />
      </label>
      <label>Motivo
        <input required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pedido não entregue, item em falta"
          style={{ width: '100%', marginTop: 4 }} />
      </label>
      {msg && !msg.ok && <div className="erro-texto">{msg.texto}</div>}
      <div className="filtros" style={{ marginBottom: 0 }}>
        <button className="btn btn-mini btn-perigo" disabled={enviando}>{enviando ? 'Estornando…' : 'Confirmar estorno'}</button>
        <button type="button" className="btn btn-mini" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </form>
  );
}

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
  tipo_entrega: 'entrega' | 'retirada';
  endereco_snapshot_json: Record<string, string> | null;
  itens: { descricao: string; quantidade: string; precoUnit: string; total: string }[] | null;
  eventos: { status: string; detalhe?: string; origem: string; em: string }[] | null;
  cobranca?: { tipo: string; pix_copia_cola?: string; linha_digitavel?: string; valor: string; pago_em?: string } | null;
  nota?: {
    numero_nf: string;
    serie?: string | null;
    chave_acesso?: string | null;
    xml_url?: string | null;
    pdf_url?: string | null;
  } | null;
  pagamento?: {
    id: string; provedor: string; metodo: string; status: string; valor: string; valor_pago?: string | null;
    provedor_ref?: string | null; expira_em?: string | null; pago_em?: string | null; criado_em: string;
    provedor_tid?: string | null; autenticacao_3ds?: string | null;
  } | null;
  total_faturado?: string | null;
  entrega?: {
    recebedor_nome: string; recebedor_documento?: string | null; observacao?: string | null;
    latitude?: string | null; longitude?: string | null; entregue_em: string;
    tem_canhoto: boolean; tem_foto: boolean;
  } | null;
  estornos?: { valor: string; status: string; codigo?: string; mensagem?: string; motivo: string; origem: string; em: string }[] | null;
}

export function PedidoDetalhe() {
  const { id } = useParams();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const [registrando, setRegistrando] = useState(false);

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

  async function consultarPagamento() {
    setConsultando(true);
    try {
      await api(`/admin/pedidos/${id}/pagamento/consultar`, { method: 'POST' });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConsultando(false);
    }
  }

  if (erro) return <div className="erro-texto">{erro}</div>;
  if (!p) return <div className="vazio">Carregando…</div>;
  const end = p.endereco_snapshot_json;
  const pg = p.pagamento;
  const jaEstornado = (p.estornos ?? [])
    .filter((e) => e.status === 'solicitado' || e.status === 'concluido')
    .reduce((t, e) => t + Number(e.valor), 0);
  const disponivelEstorno = pg ? Number(pg.valor_pago ?? pg.valor) - jaEstornado : 0;
  const podeEstornar = !!pg && pg.metodo === 'cartao' && (pg.status === 'pago' || pg.status === 'estorno_solicitado')
    && disponivelEstorno > 0.009 && sessao()?.papel === 'admin';
  const estornoFalhouDefinitivo = p.status === 'CANCELADO' && pg?.status === 'pago' && (p.estornos ?? []).some((e) => e.status === 'falhou');
  const pixADevolver = p.status === 'CANCELADO' && pg?.metodo === 'pix' && pg.status === 'pago';
  const podeRegistrarEntrega = !['CANCELADO', 'AGUARDANDO_PAGAMENTO'].includes(p.status);

  return (
    <>
      <h1>
        <Link to="/pedidos">Pedidos</Link> › Pedido #{p.numero}{' '}
        <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>{' '}
        <Link to={`/pedidos/${p.id}/dossie`} className="btn btn-mini" style={{ marginLeft: 8, fontSize: 12.5 }}>
          Dossiê de contestação
        </Link>
      </h1>

      {estornoFalhouDefinitivo && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fecaca' }}>
          <strong>Pedido cancelado e o estorno automático do cartão não passou.</strong>{' '}
          Veja o motivo em "Estornos" abaixo e devolva pelo portal useRede ou por PIX/transferência.
        </div>
      )}
      {pixADevolver && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fde68a' }}>
          <strong>Pedido cancelado com PIX pago:</strong> devolver {fmtMoeda(pg?.valor_pago ?? pg?.valor)} para a conta de origem em até 2 dias úteis
          (a devolução PIX ainda é manual, pelo app/portal do Itaú).
        </div>
      )}

      {p.status === 'FALHA_INTEGRACAO' && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fecaca' }}>
          <strong>Falha ao enviar para o ERP.</strong>{' '}
          <button className="btn btn-mini" onClick={reenviar} disabled={reenviando}>
            {reenviando ? 'Reenviando…' : 'Reenviar ao ERP'}
          </button>
        </div>
      )}

      {p.pagamento && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="rotulo">Pagamento online</div>
          <div style={{ marginTop: 8 }}>
            <div>
              {p.pagamento.metodo === 'pix' ? 'PIX' : 'Cartão'} · {p.pagamento.provedor === 'itau_pix' ? 'Itaú' : p.pagamento.provedor}
              {' · '}
              <span className={`badge pag-${p.pagamento.status}`}>{PAGAMENTO_STATUS_LABEL[p.pagamento.status] ?? p.pagamento.status}</span>
            </div>
            <div style={{ marginTop: 6 }}>
              Valor cobrado: {fmtMoeda(p.pagamento.valor)}
              {p.pagamento.valor_pago && <> · Valor pago: {fmtMoeda(p.pagamento.valor_pago)}</>}
            </div>
            {p.pagamento.provedor_ref && (
              <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                {p.pagamento.metodo === 'pix' ? 'txid' : 'ref'}: {p.pagamento.provedor_ref}
                {p.pagamento.provedor_tid && <> · tid: {p.pagamento.provedor_tid}</>}
              </div>
            )}
            {p.pagamento.metodo === 'cartao' && (
              <div style={{ marginTop: 6 }}>
                {p.pagamento.autenticacao_3ds
                  ? AUTENTICACAO_3DS[p.pagamento.autenticacao_3ds] ?? `3DS: código ${p.pagamento.autenticacao_3ds}`
                  : <span style={{ color: 'var(--texto-2)' }}>Sem autenticação 3DS (chargeback por fraude fica com a distribuidora)</span>}
              </div>
            )}
            <div style={{ marginTop: 6, color: 'var(--texto-2)' }}>
              Criado {fmtData(p.pagamento.criado_em)}
              {p.pagamento.expira_em && <> · Expira {fmtData(p.pagamento.expira_em)}</>}
              {p.pagamento.pago_em && <> · Pago em {fmtData(p.pagamento.pago_em)}</>}
            </div>
            {p.pagamento.valor_pago && p.total_faturado && Number(p.pagamento.valor_pago) > Number(p.total_faturado) && (
              <div className="valor alerta" style={{ fontSize: 15, marginTop: 8 }}>
                A devolver: {fmtMoeda(Number(p.pagamento.valor_pago) - Number(p.total_faturado))}
                <span style={{ fontWeight: 400, fontSize: 12.5 }}> (faturado menor que o pago)</span>
              </div>
            )}
          </div>
          {p.pagamento.status === 'pendente' && (
            <button className="btn btn-mini" style={{ marginTop: 12 }} onClick={consultarPagamento} disabled={consultando}>
              {consultando ? 'Consultando…' : p.pagamento.metodo === 'pix' ? 'Consultar no Itaú' : 'Consultar na Rede'}
            </button>
          )}
          {!!p.estornos?.length && (
            <div style={{ marginTop: 12 }}>
              <div className="rotulo">Estornos</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {p.estornos.map((e, k) => (
                  <li key={k}>
                    {fmtData(e.em)} · {fmtMoeda(e.valor)} · <strong>{ESTORNO_STATUS_LABEL[e.status] ?? e.status}</strong>
                    {' '}<small>({e.origem === 'sistema' ? 'automático' : e.origem})</small> — {e.motivo}
                    {e.status === 'falhou' && e.mensagem && <div className="erro-texto">Rede: {e.mensagem}{e.codigo ? ` (${e.codigo})` : ''}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {podeEstornar && <EstornarCartao pedidoId={p.id} disponivel={disponivelEstorno} onPronto={carregar} />}
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
              <div className="mono">{fmtDocumento(p.documento)}</div>
              <div>{p.email}</div>
              {p.telefone && <div>{p.telefone}</div>}
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="rotulo">Entrega</div>
            <div style={{ marginTop: 8 }}>
              {end ? (
                <>
                  {end.logradouro}, {end.numero} {end.complemento ?? ''}<br />
                  {end.bairro} — {end.cidade}/{end.uf}<br />
                  CEP {end.cep}
                </>
              ) : (
                <strong>Retirada na distribuidora</strong>
              )}
            </div>
            {p.observacoes && <div style={{ marginTop: 8, color: 'var(--texto-2)' }}>Obs: {p.observacoes}</div>}
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="rotulo">Comprovante de entrega</div>
            {p.entrega ? (
              <div style={{ marginTop: 8 }}>
                <div>Recebido por <strong>{p.entrega.recebedor_nome}</strong>
                  {p.entrega.recebedor_documento && <> · doc. <span className="mono">{p.entrega.recebedor_documento}</span></>}
                </div>
                <div style={{ color: 'var(--texto-2)', marginTop: 2 }}>
                  {fmtData(p.entrega.entregue_em)}
                  {p.entrega.latitude && p.entrega.longitude && (
                    <> · <a href={`https://www.google.com/maps?q=${p.entrega.latitude},${p.entrega.longitude}`} target="_blank" rel="noreferrer">ver no mapa</a></>
                  )}
                </div>
                {p.entrega.observacao && <div style={{ marginTop: 4 }}>Obs: {p.entrega.observacao}</div>}
                {p.entrega.tem_canhoto && <FotoProtegida path={`/admin/pedidos/${p.id}/entrega/canhoto`} alt="Canhoto assinado" />}
                {p.entrega.tem_foto && <FotoProtegida path={`/admin/pedidos/${p.id}/entrega/foto`} alt="Foto da entrega" />}
                {!registrando && (
                  <button className="btn btn-mini" style={{ marginTop: 10 }} onClick={() => setRegistrando(true)}>Corrigir comprovante</button>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 8, color: 'var(--texto-2)' }}>
                Sem comprovante. Na entrega, colha a assinatura no canhoto da DANFE com nome e documento de quem recebeu e registre aqui.
              </div>
            )}
            {!p.entrega && !registrando && podeRegistrarEntrega && (
              <button className="btn btn-mini" style={{ marginTop: 10 }} onClick={() => setRegistrando(true)}>Registrar entrega</button>
            )}
            {registrando && (
              <RegistrarEntrega pedidoId={p.id} refazer={!!p.entrega?.tem_canhoto} onPronto={() => { setRegistrando(false); carregar(); }} />
            )}
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="rotulo">
              Pagamento ({p.forma_pagamento === 'cartao' && p.pagamento ? 'Cartão de crédito online' : PAGAMENTO_LABEL[p.forma_pagamento] ?? p.forma_pagamento.toUpperCase()}
              {p.condicao_pagamento ? ` — ${p.condicao_pagamento}` : ''})
            </div>
            <div style={{ marginTop: 8 }}>
              {p.cobranca ? (
                <>
                  <div>{fmtMoeda(p.cobranca.valor)} {p.cobranca.pago_em ? '· ✅ pago' : '· aguardando pagamento'}</div>
                  {p.cobranca.pix_copia_cola && <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>{p.cobranca.pix_copia_cola}</div>}
                  {p.cobranca.linha_digitavel && <div className="mono" style={{ marginTop: 6 }}>{p.cobranca.linha_digitavel}</div>}
                </>
              ) : p.forma_pagamento === 'cartao' && p.pagamento ? (
                <span style={{ color: 'var(--texto-2)' }}>Cobrado no app pela Rede (detalhes em "Pagamento online")</span>
              ) : p.forma_pagamento === 'cartao' ? (
                <span style={{ color: 'var(--texto-2)' }}>Cliente paga na maquininha ao receber o pedido</span>
              ) : p.status === 'RECEBIDO' || p.status === 'ENVIADO_ERP' ? (
                <span style={{ color: 'var(--texto-2)' }}>Aguardando o ERP gerar a cobrança</span>
              ) : null}
            </div>
            {p.nota && (
              <div style={{ marginTop: 8 }}>
                <div>
                  NF: <span className="mono">{p.nota.numero_nf}</span>
                  {p.nota.serie && <span className="mono"> / {p.nota.serie}</span>}
                </div>
                {p.nota.chave_acesso && (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--texto-2)', marginTop: 2 }}>
                    {p.nota.chave_acesso}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                  {p.nota.pdf_url && (
                    <a href={p.nota.pdf_url} target="_blank" rel="noreferrer">Abrir DANFE</a>
                  )}
                  {p.nota.xml_url && (
                    <a href={p.nota.xml_url} target="_blank" rel="noreferrer">Baixar XML</a>
                  )}
                </div>
              </div>
            )}
            {p.erp_pedido_id && <div style={{ marginTop: 8 }}>Pedido ERP: <span className="mono">{p.erp_pedido_id}</span></div>}
          </div>
        </div>
      </div>
    </>
  );
}
