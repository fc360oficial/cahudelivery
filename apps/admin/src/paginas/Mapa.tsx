import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { api, fmtData, fmtDocumento, fmtMoeda, STATUS_LABEL } from '../api';

interface ClienteMapa {
  id: string; nome: string; documento: string; cidade: string; bairro: string; endereco: string;
  lat: number; lng: number; precisao: 'cep' | 'endereco';
}
interface PedidoMapa {
  id: string; numero: number; clienteId: string; cliente: string; status: string; total: number; criadoEm: string;
  endereco: string; lat: number; lng: number; precisao: 'cep' | 'endereco';
}
interface RespostaMapa {
  clientes: ClienteMapa[];
  pedidos: PedidoMapa[];
  semLocalizacao: { clientes: number; pedidos: number };
  geocodificacao: { emAndamento: boolean; ultimaExecucaoEm: string | null };
}

type Modo = 'ambos' | 'clientes' | 'pedidos';
type Periodo = 'hoje' | '7' | '30';

const STATUS_FILTRO = ['RECEBIDO', 'ENVIADO_ERP', 'FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE', 'FALHA_INTEGRACAO'];
const COR_BORDA: Record<string, string> = {
  RECEBIDO: '#1a1a1a', ENVIADO_ERP: '#1a1a1a', FATURADO: '#1d4ed8', EM_SEPARACAO: '#1d4ed8',
  SAIU_ENTREGA: '#b45309', ENTREGUE: '#14803c', FALHA_INTEGRACAO: '#c02626', CANCELADO: '#65707e',
};
const CENTRO_PADRAO: [number, number] = [-9.39, -40.5]; // Petrolina

function isoDia(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function intervalo(periodo: Periodo): { de: string; ate: string } {
  const hoje = new Date();
  const de = new Date(hoje);
  if (periodo === '7') de.setDate(hoje.getDate() - 7);
  if (periodo === '30') de.setDate(hoje.getDate() - 30);
  return { de: isoDia(de), ate: isoDia(hoje) };
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function Mapa() {
  const [params, setParams] = useSearchParams();
  const modo = (params.get('modo') as Modo) || 'ambos';
  const periodo = (params.get('periodo') as Periodo) || '7';
  const statusSel = useMemo(() => (params.get('status') ?? '').split(',').filter(Boolean), [params]);

  const [dados, setDados] = useState<RespostaMapa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState(false);

  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.MarkerClusterGroup | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);

  const atualizarParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    setParams(p);
  };

  const carregar = useCallback(() => {
    const { de, ate } = intervalo(periodo);
    const q = new URLSearchParams({ de, ate });
    if (statusSel.length) q.set('status', statusSel.join(','));
    setErro(null);
    api<RespostaMapa>(`/admin/mapa?${q}`).then(setDados).catch((e) => setErro(e.message));
  }, [periodo, statusSel]);

  useEffect(carregar, [carregar]);

  // Enquanto geocodifica, consulta a cada 10 s até terminar.
  useEffect(() => {
    if (!dados?.geocodificacao.emAndamento) return;
    const t = setInterval(carregar, 10_000);
    return () => clearInterval(t);
  }, [dados?.geocodificacao.emAndamento, carregar]);

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current).setView(CENTRO_PADRAO, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    const camada = L.markerClusterGroup({ maxClusterRadius: 40 });
    mapa.addLayer(camada);
    mapaRef.current = mapa;
    camadaRef.current = camada;
    return () => {
      mapa.remove();
      mapaRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // Redesenha os pontos quando dados/modo mudam.
  useEffect(() => {
    const mapa = mapaRef.current;
    const camada = camadaRef.current;
    if (!mapa || !camada || !dados) return;
    camada.clearLayers();
    const pontos: L.LatLngExpression[] = [];

    if (modo !== 'pedidos') {
      for (const c of dados.clientes) {
        const m = L.circleMarker([c.lat, c.lng], { radius: 7, color: '#4b5563', weight: 1, fillColor: '#6b7280', fillOpacity: 0.85 });
        m.bindPopup(
          `<div class="popup-mapa">
             <strong>${esc(c.nome)}</strong><br>
             <span class="mono">${esc(fmtDocumento(c.documento))}</span><br>
             ${esc(c.endereco)} - ${esc(c.bairro)}, ${esc(c.cidade)}<br>
             ${c.precisao === 'cep' ? '<small>Localização aproximada pelo CEP</small><br>' : ''}
             <a href="/clientes?busca=${encodeURIComponent(c.documento)}">Abrir cliente</a>
           </div>`,
        );
        camada.addLayer(m);
        pontos.push([c.lat, c.lng]);
      }
    }
    if (modo !== 'clientes') {
      for (const p of dados.pedidos) {
        const m = L.circleMarker([p.lat, p.lng], { radius: 9, color: COR_BORDA[p.status] ?? '#1a1a1a', weight: 2.5, fillColor: '#FFD500', fillOpacity: 0.95 });
        m.bindPopup(
          `<div class="popup-mapa">
             <strong>Pedido #${p.numero}</strong> <span class="badge ${esc(p.status)}">${esc(STATUS_LABEL[p.status] ?? p.status)}</span><br>
             ${esc(p.cliente)}<br>
             ${esc(fmtMoeda(p.total))} · ${esc(fmtData(p.criadoEm))}<br>
             ${esc(p.endereco)}<br>
             ${p.precisao === 'cep' ? '<small>Localização aproximada pelo CEP</small><br>' : ''}
             <a href="/pedidos/${p.id}">Abrir pedido</a>
           </div>`,
        );
        camada.addLayer(m);
        pontos.push([p.lat, p.lng]);
      }
    }
    if (pontos.length) mapa.fitBounds(L.latLngBounds(pontos), { padding: [30, 30], maxZoom: 15 });
    else mapa.setView(CENTRO_PADRAO, 12);
  }, [dados, modo]);

  const geocodificar = async () => {
    setDisparando(true);
    try {
      await api('/admin/mapa/geocodificar', { method: 'POST' });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setDisparando(false);
    }
  };

  const alternarStatus = (s: string) => {
    const novo = statusSel.includes(s) ? statusSel.filter((x) => x !== s) : [...statusSel, s];
    atualizarParams({ status: novo.join(',') });
  };

  const emAndamento = dados?.geocodificacao.emAndamento ?? false;
  const semLoc = dados?.semLocalizacao;

  return (
    <>
      <h1>Mapa</h1>
      <div className="filtros" style={{ alignItems: 'center' }}>
        {(['ambos', 'clientes', 'pedidos'] as Modo[]).map((m) => (
          <button key={m} className={`pill-filtro ${modo === m ? 'ativo' : ''}`} onClick={() => atualizarParams({ modo: m === 'ambos' ? '' : m })}>
            {m === 'ambos' ? 'Ambos' : m === 'clientes' ? 'Clientes' : 'Pedidos'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {semLoc && (
          <span className="mapa-aviso">
            {semLoc.clientes} cliente{semLoc.clientes === 1 ? '' : 's'} / {semLoc.pedidos} pedido{semLoc.pedidos === 1 ? '' : 's'} sem localização
          </span>
        )}
        <button className="btn btn-claro" onClick={geocodificar} disabled={emAndamento || disparando}>
          {emAndamento ? 'Geocodificando…' : 'Geocodificar pendentes'}
        </button>
      </div>
      {modo !== 'clientes' && (
        <div className="filtros">
          <button className={`pill-filtro ${!statusSel.length ? 'ativo' : ''}`} onClick={() => atualizarParams({ status: '' })}>Todos</button>
          {STATUS_FILTRO.map((s) => (
            <button key={s} className={`pill-filtro ${statusSel.includes(s) ? 'ativo' : ''}`} onClick={() => alternarStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {(['hoje', '7', '30'] as Periodo[]).map((p) => (
            <button key={p} className={`pill-filtro ${periodo === p ? 'ativo' : ''}`} onClick={() => atualizarParams({ periodo: p === '7' ? '' : p })}>
              {p === 'hoje' ? 'Hoje' : `${p} dias`}
            </button>
          ))}
        </div>
      )}
      {erro && (
        <div className="erro-texto">
          {erro} <button className="btn btn-mini btn-claro" onClick={carregar}>Tentar de novo</button>
        </div>
      )}
      <div className="mapa-legenda">
        <span><i className="mapa-ponto cliente" /> Cliente</span>
        <span><i className="mapa-ponto pedido" /> Pedido (borda = status)</span>
        {!dados && !erro && <span className="vazio">Carregando…</span>}
      </div>
      <div ref={divRef} className="mapa-wrap" />
    </>
  );
}
