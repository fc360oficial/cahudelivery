import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio } from '../../vendas-ui';
import {
  COR_PARADA, CORES_CARGA, FotoAberta, FotosDaParada, MOTIVOS, ROTULO_PARADA, TIPO_OCORRENCIA,
  duracao, hoje, hora, km, situacaoCarga, type Acompanhamento, type Carga, type Ocorrencia,
} from './acompanhamento';
import { DetalheEntrega } from './DetalheEntrega';
import '../vendas/cadastros.css';
import '../vendas/inicio-pedidos.css';
import './entregas.css';
import './em-rota.css';

const ATUALIZA_MS = 30_000;
const CENTRO = L.latLng(-8.13, -34.95);

function iconeParada(cor: string, ordem: number) {
  return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="er-pino" style="background:${cor}">${ordem}</div>` });
}
function iconeCaminhao(cor: string, rotulo: string, semSinal: boolean) {
  return L.divIcon({
    className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div class="er-caminhao${semSinal ? ' sem-sinal' : ''}" style="background:${cor}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M2 7h11v9H2z"/><path d="M13 10h4l4 3v3h-8"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg><span>${rotulo}</span></div>`,
  });
}

function Mapa({ cargas, cores, selecionada, onSelecionar }: { cargas: Carga[]; cores: Map<string, string>; selecionada: string | null; onSelecionar: (id: string) => void }) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const enquadrou = useRef<string | null>(null);

  useEffect(() => {
    if (!div.current || mapa.current) return;
    const m = L.map(div.current).setView(CENTRO, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;
    return () => { m.remove(); mapa.current = null; };
  }, []);

  useEffect(() => {
    const m = mapa.current, g = camada.current;
    if (!m || !g) return;
    g.clearLayers();
    const pontos: L.LatLngExpression[] = [];
    for (const c of cargas) {
      const cor = cores.get(c.id) ?? '#1d5be0';
      const apagada = selecionada !== null && selecionada !== c.id;
      const opacidade = apagada ? 0.2 : 1;
      const paradas = c.paradas.filter((p) => p.latitude !== null && p.longitude !== null);
      if (paradas.length) {
        L.polyline(paradas.map((p) => [p.latitude!, p.longitude!]), { color: cor, weight: 2, dashArray: '6 8', opacity: 0.5 * opacidade }).addTo(g);
      }
      if (c.trajeto.length > 1) L.polyline(c.trajeto, { color: cor, weight: 5, opacity: 0.85 * opacidade }).addTo(g);
      for (const p of paradas) {
        const mk = L.marker([p.latitude!, p.longitude!], { icon: iconeParada(COR_PARADA[p.status], p.ordem), opacity: opacidade });
        mk.bindTooltip(`${p.ordem}. ${p.cliente} · ${ROTULO_PARADA[p.status][0]}`);
        mk.on('click', () => onSelecionar(c.id));
        mk.addTo(g);
        if (!apagada) pontos.push([p.latitude!, p.longitude!]);
      }
      if (c.status === 'em_rota' && c.ultimaPosicao) {
        const semSinal = (c.semSinalMin ?? 0) > 10;
        const mk = L.marker([c.ultimaPosicao.lat, c.ultimaPosicao.lng], {
          icon: iconeCaminhao(cor, `${c.caminhao?.nome ?? `Carga ${c.numero}`}${semSinal ? ' · sem sinal' : ''}`, semSinal),
          opacity: opacidade, zIndexOffset: 1000,
        });
        mk.bindTooltip(`${c.motorista?.nome ?? ''} · último sinal ${hora(c.ultimaPosicao.em)}`);
        mk.on('click', () => onSelecionar(c.id));
        mk.addTo(g);
        if (!apagada) pontos.push([c.ultimaPosicao.lat, c.ultimaPosicao.lng]);
      }
    }
    // Enquadra só quando muda o que está em foco (não a cada atualização de 30 s).
    const chave = `${selecionada ?? 'todas'}|${cargas.length}`;
    if (pontos.length && enquadrou.current !== chave) {
      m.fitBounds(L.latLngBounds(pontos), { padding: [40, 40], maxZoom: 15 });
      enquadrou.current = chave;
    }
  }, [cargas, cores, selecionada, onSelecionar]);

  return <div ref={div} className="er-mapa" />;
}

function Resolver({ o, onFeito }: { o: Ocorrencia; onFeito: () => void }) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (o.resolvidaEm) return <div className="er-resolvida">Resolvida às {hora(o.resolvidaEm)}: {o.resolucao}</div>;
  return (
    <form className="er-resolver" onSubmit={async (e) => {
      e.preventDefault();
      setEnviando(true); setErro(null);
      try { await api(`/admin/entregas/ocorrencias/${o.id}/resolver`, { method: 'POST', body: JSON.stringify({ resolucao: texto }) }); onFeito(); }
      catch (err) { setErro((err as Error).message); }
      finally { setEnviando(false); }
    }}>
      <input type="text" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que foi combinado (ex.: crédito no Dlinks)" maxLength={500} aria-label="O que foi combinado com o cliente" />
      <button type="submit" className="cad-btn" disabled={enviando || texto.trim().length < 3}>Registrar</button>
      {erro && <span className="ent-alerta">{erro}</span>}
    </form>
  );
}

function Detalhe({ c, cor, agora, onVoltar, onAbrir, onAbrirEntrega, onAtualizar }: { c: Carga; cor: string; agora: Date; onVoltar: () => void; onAbrir: (url: string, rotulo: string) => void; onAbrirEntrega: (id: string) => void; onAtualizar: () => void }) {
  const s = situacaoCarga(c, agora);
  const fim = c.retornoEm ? new Date(c.retornoEm) : agora;
  const naRua = c.saidaEm ? Math.round((fim.getTime() - new Date(c.saidaEm).getTime()) / 60000) : null;
  const parado = c.paradas.reduce((t, p) => t + (p.noClienteMin ?? 0), 0);
  return (
    <Cartao className="er-detalhe">
      <button type="button" className="er-voltar" onClick={onVoltar}>← Todos os caminhões</button>
      <div className="er-cam-cabeca">
        <span className="er-cam-cor" style={{ background: cor }} aria-hidden="true" />
        <div className="er-cam-nome"><strong>{c.caminhao?.nome ?? 'Sem caminhão'} · Carga {c.numero}</strong><small>{c.motorista?.nome ?? 'Sem motorista'}{c.caminhao?.placa ? ` · ${c.caminhao.placa}` : ''}{c.motorista?.telefone ? ` · ${c.motorista.telefone}` : ''}</small></div>
        <Selo variante={s.selo[1]}>{s.selo[0]}</Selo>
      </div>
      <p className="er-agora">{s.texto}</p>
      <div className="er-resumo">
        <div><span>Saiu</span><strong>{hora(c.saidaEm)}</strong></div>
        <div><span>Na rua</span><strong>{duracao(naRua)}</strong></div>
        <div><span>Parado em clientes</span><strong>{duracao(parado || null)}</strong></div>
      </div>
      <ol className="er-paradas">
        {c.paradas.map((p) => {
          const [rotulo, variante] = ROTULO_PARADA[p.status];
          return (
            <li key={p.id} className="er-parada">
              <span className="er-ordem" style={{ background: COR_PARADA[p.status] }}>{p.ordem}</span>
              <div className="er-parada-corpo">
                <div className="er-parada-nome"><button type="button" className="ent-abrir" onClick={() => onAbrirEntrega(p.entregaId)}>{p.cliente}</button><Selo variante={variante}>{rotulo}</Selo></div>
                <span className="er-suave">{[p.endereco, p.bairro].filter(Boolean).join(' · ')}{p.nota ? ` · NF ${p.nota}` : ''} · {p.volumes.toLocaleString('pt-BR')} vol.</span>
                <div className="er-tempos">
                  {p.status === 'pendente' ? <span>Ainda não chegou</span> : (
                    <>
                      <span>Trajeto <b>{duracao(p.trajetoMin)}</b></span>
                      <span>Chegou <b>{hora(p.chegadaEm)}</b></span>
                      {p.concluidaEm && <span>Saiu <b>{hora(p.concluidaEm)}</b></span>}
                      <span>{p.status === 'no_cliente' ? 'No cliente há' : 'No cliente'} <b>{duracao(p.noClienteMin)}</b></span>
                    </>
                  )}
                </div>
                {p.recebedorNome && <span className="er-suave">Recebido por <b>{p.recebedorNome}</b>{p.recebedorDocumento ? ` · ${p.recebedorDocumento}` : ''}</span>}
                {p.chegadaDistanciaM !== null && p.chegadaDistanciaM > 1500 && <div className="er-nota aviso">"Cheguei" marcado a {km(p.chegadaDistanciaM)} do endereço do cliente.</div>}
                {p.status === 'nao_entregue' && <div className="er-nota erro">Motivo: {MOTIVOS[p.motivoNaoEntrega ?? ''] ?? 'não informado'}{p.observacao ? `. ${p.observacao}` : ''}</div>}
                {p.ocorrencias.map((o) => (
                  <div key={o.id} className="er-nota aviso">
                    <b>{TIPO_OCORRENCIA[o.tipo]}</b> às {hora(o.registradaEm)}: {[o.quantidade !== null ? `${o.quantidade.toLocaleString('pt-BR')}x` : null, o.produtoDescricao, o.observacao].filter(Boolean).join(' · ')}
                    <Resolver o={o} onFeito={onAtualizar} />
                  </div>
                ))}
                <FotosDaParada p={p} onAbrir={onAbrir} />
              </div>
            </li>
          );
        })}
      </ol>
    </Cartao>
  );
}

function CartaoCarga({ c, cor, agora, ativa, onClick }: { c: Carga; cor: string; agora: Date; ativa: boolean; onClick: () => void }) {
  const s = situacaoCarga(c, agora);
  const n = c.paradas.length || 1;
  const conta = (st: string) => c.paradas.filter((p) => p.status === st).length;
  const semSinal = c.status === 'em_rota' && (c.semSinalMin ?? 0) > 10;
  return (
    <button type="button" className={`er-cartao${ativa ? ' ativa' : ''}`} onClick={onClick}>
      <div className="er-cam-cabeca">
        <span className="er-cam-cor" style={{ background: cor }} aria-hidden="true" />
        <div className="er-cam-nome"><strong>{c.caminhao?.nome ?? 'Sem caminhão'} · Carga {c.numero}</strong><small>{c.motorista?.nome ?? 'Sem motorista'}{c.caminhao?.placa ? ` · ${c.caminhao.placa}` : ''}</small></div>
        <Selo variante={s.selo[1]}>{s.selo[0]}</Selo>
      </div>
      <div className={`er-agora${semSinal ? ' erro' : ''}`}>{semSinal ? `Sem localização há ${c.semSinalMin} min · ` : ''}{s.texto}</div>
      <div className="er-barra" aria-hidden="true">
        <i style={{ width: `${(conta('entregue') / n) * 100}%`, background: COR_PARADA.entregue }} />
        <i style={{ width: `${(conta('nao_entregue') / n) * 100}%`, background: COR_PARADA.nao_entregue }} />
        <i style={{ width: `${(conta('no_cliente') / n) * 100}%`, background: COR_PARADA.no_cliente }} />
      </div>
      <div className="er-rodape">
        <span>{conta('entregue') + conta('nao_entregue')} de {c.paradas.length} clientes</span>
        <span>{c.saidaEm ? `saiu ${hora(c.saidaEm)}` : ''}{c.status === 'em_rota' && c.ultimaPosicao ? ` · último sinal ${hora(c.ultimaPosicao.em)}` : ''}</span>
      </div>
    </button>
  );
}

export function EntregasEmRota() {
  const [data, setData] = useState(hoje());
  const [dados, setDados] = useState<Acompanhamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [foto, setFoto] = useState<{ url: string; rotulo: string } | null>(null);
  const [entregaAberta, setEntregaAberta] = useState<string | null>(null);
  const fecharEntrega = useCallback(() => setEntregaAberta(null), []);
  const pedido = useRef(0);

  const carregar = useCallback(() => {
    const n = ++pedido.current;
    api<Acompanhamento>(`/admin/entregas/acompanhamento?data=${data}`)
      .then((d) => { if (n === pedido.current) { setDados(d); setErro(null); } })
      .catch((e: Error) => { if (n === pedido.current) setErro(e.message); });
  }, [data]);
  useEffect(() => {
    setDados(null); setSelecionada(null);
    carregar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, ATUALIZA_MS);
    return () => clearInterval(t);
  }, [carregar]);

  const cores = useMemo(() => new Map((dados?.cargas ?? []).map((c, i) => [c.id, CORES_CARGA[i % CORES_CARGA.length]])), [dados]);
  const agora = dados ? new Date(dados.agora) : new Date();
  const sel = dados?.cargas.find((c) => c.id === selecionada) ?? null;
  const abrir = useCallback((url: string, rotulo: string) => setFoto({ url, rotulo }), []);
  const r = dados?.resumo;

  return (
    <div className="er-pagina">
      <CabecalhoPagina
        titulo="Em rota"
        subtitulo="Onde está cada caminhão, quanto tempo ficou em cada cliente e o que precisa da sua atenção. Atualiza sozinho a cada 30 segundos."
        acoes={
          <>
            <label className="ent-data">Dia
              <input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
            </label>
            <button type="button" className="cad-btn cad-btn-claro" onClick={carregar}>Atualizar</button>
          </>
        }
      />
      {erro && <div className="cad-erro">{erro}</div>}
      {!dados && !erro && <Cartao><Vazio mensagem="Carregando…" /></Cartao>}
      {dados && r && (
        <>
          <div className="grid-indicadores er-indicadores">
            <Cartao className="indicador"><div><div className="rotulo">Caminhões em rota</div><div className="valor">{r.emRota}</div><div className="nota">{r.encerradas} já voltaram · {r.aguardandoSaida} ainda no CD</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Entregues</div><div className="valor">{r.entregues}/{r.paradas}</div><div className="nota">{r.naoEntregues ? `${r.naoEntregues} não entregue${r.naoEntregues > 1 ? 's' : ''}` : 'nenhuma recusa'}</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">No cliente agora</div><div className="valor">{r.noCliente}</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Tempo médio no cliente</div><div className="valor">{duracao(r.tempoMedioNoClienteMin)}</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Precisa de atenção</div><div className={`valor${dados.alertas.length ? ' er-vermelho' : ''}`}>{dados.alertas.length}</div></div></Cartao>
          </div>

          {dados.alertas.length > 0 && (
            <div className="er-alertas">
              {dados.alertas.slice(0, 6).map((a, i) => (
                <button key={`${a.tipo}-${a.paradaId ?? a.cargaId}-${a.ocorrenciaId ?? i}`} type="button" className={`er-alerta ${a.tipo === 'sem_sinal' || a.tipo === 'nao_entregue' ? 'erro' : 'aviso'}`} onClick={() => setSelecionada(a.cargaId)}>
                  <span className="er-alerta-icone" aria-hidden="true">!</span><span>{a.texto}</span><span className="er-alerta-hora">{hora(a.em)}</span>
                </button>
              ))}
              {dados.alertas.length > 6 && <span className="er-suave">E mais {dados.alertas.length - 6}. Clique num caminhão para ver tudo.</span>}
            </div>
          )}

          {dados.cargas.length === 0 ? (
            <Cartao><Vazio mensagem="Nenhuma carga autorizada neste dia. As cargas aparecem aqui depois que o gerente do CD autoriza em Montar cargas." /></Cartao>
          ) : (
            <div className="er-painel">
              <Cartao className="er-mapa-caixa">
                <Mapa cargas={dados.cargas} cores={cores} selecionada={selecionada} onSelecionar={setSelecionada} />
                <div className="er-legenda">
                  <span><i style={{ background: COR_PARADA.entregue }} />Entregue</span>
                  <span><i style={{ background: COR_PARADA.no_cliente }} />No cliente</span>
                  <span><i style={{ background: COR_PARADA.pendente }} />Falta entregar</span>
                  <span><i style={{ background: COR_PARADA.nao_entregue }} />Não entregue</span>
                  <span>Linha cheia: caminho feito · tracejada: ordem das entregas</span>
                </div>
              </Cartao>
              <div className="er-lado">
                {sel ? (
                  <Detalhe c={sel} cor={cores.get(sel.id)!} agora={agora} onVoltar={() => setSelecionada(null)} onAbrir={abrir} onAbrirEntrega={setEntregaAberta} onAtualizar={carregar} />
                ) : (
                  dados.cargas.map((c) => <CartaoCarga key={c.id} c={c} cor={cores.get(c.id)!} agora={agora} ativa={false} onClick={() => setSelecionada(c.id)} />)
                )}
              </div>
            </div>
          )}
        </>
      )}
      <FotoAberta foto={foto} onFechar={() => setFoto(null)} />
      <DetalheEntrega entregaId={entregaAberta} onFechar={fecharEntrega} />
    </div>
  );
}
