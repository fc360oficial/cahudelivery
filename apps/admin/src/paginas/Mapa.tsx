import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, fmtData, fmtDocumento, fmtMoeda, STATUS_LABEL } from '../api';

interface ClienteMapa {
  id: string; nome: string; documento: string; cidade: string; bairro: string; endereco: string;
  lat: number; lng: number; precisao: 'cep' | 'endereco';
}
interface PedidoMapa {
  id: string; numero: number; clienteId: string; cliente: string; status: string; total: number; criadoEm: string;
  endereco: string; cidade: string; bairro: string; lat: number; lng: number; precisao: 'cep' | 'endereco';
}
interface ClienteSemLoc {
  id: string; nome: string; documento: string; cep: string | null; endereco: string | null; tentativas: number;
}
interface RespostaMapa {
  clientes: ClienteMapa[];
  pedidos: PedidoMapa[];
  semLocalizacao: { clientes: number; pedidos: number; listaClientes: ClienteSemLoc[] };
  geocodificacao: { emAndamento: boolean; ultimaExecucaoEm: string | null };
}

type Modo = 'ambos' | 'clientes' | 'pedidos';
type Periodo = 'hoje' | '7' | '30';

interface Municipio {
  nome: string;
  cor: string;
  clientes: ClienteMapa[];
  pedidos: PedidoMapa[];
  centro: [number, number];
}

const STATUS_FILTRO = ['RECEBIDO', 'ENVIADO_ERP', 'FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE', 'FALHA_INTEGRACAO'];
const COR_BORDA: Record<string, string> = {
  RECEBIDO: '#1a1a1a', ENVIADO_ERP: '#1a1a1a', FATURADO: '#1d4ed8', EM_SEPARACAO: '#1d4ed8',
  SAIU_ENTREGA: '#b45309', ENTREGUE: '#14803c', FALHA_INTEGRACAO: '#c02626', CANCELADO: '#65707e',
};
// Uma cor fixa por município, atribuída em ordem alfabética.
const PALETA = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#4d7c0f', '#7c3aed', '#b45309', '#0f766e', '#be123c'];
const MIN_BOLHA = 3;
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
function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
/** "RECIFE" e "Recife" são o mesmo município: chave sem acento/caixa, nome exibido em Título. */
function chaveMunicipio(cidade: string) {
  return normalizar(cidade).trim().replace(/\s+/g, ' ');
}
const MINUSCULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
function nomeMunicipio(cidade: string) {
  return cidade.trim().toLowerCase().split(/\s+/).map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

function iconePino(fill: string, stroke: string, tamanho = 28) {
  const h = Math.round(tamanho * 1.38);
  return L.divIcon({
    className: 'mapa-pino',
    html: `<svg width="${tamanho}" height="${h}" viewBox="0 0 26 36"><path d="M13 1C6.4 1 1 6.4 1 13c0 9 12 22 12 22s12-13 12-22C25 6.4 19.6 1 13 1z" fill="${fill}" stroke="${stroke}" stroke-width="2"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>`,
    iconSize: [tamanho, h],
    iconAnchor: [tamanho / 2, h],
    popupAnchor: [0, -h + 4],
  });
}

function iconeBolha(m: Municipio, modo: Modo) {
  const n = modo === 'clientes' ? m.clientes.length : modo === 'pedidos' ? m.pedidos.length : Math.max(m.clientes.length, m.pedidos.length);
  const d = Math.round(Math.min(96, Math.max(48, 40 + Math.sqrt(n) * 7)));
  // Ambos: número grande = clientes; pedidos do período numa etiqueta amarela, só quando existem.
  const principal = modo === 'pedidos' ? m.pedidos.length : m.clientes.length;
  const etiquetaPedidos = modo === 'ambos' && m.pedidos.length ? `<i class="mapa-bolha-ped" title="pedidos no período">${m.pedidos.length}</i>` : '';
  const titulo = modo === 'clientes' ? `${m.clientes.length} clientes` : modo === 'pedidos' ? `${m.pedidos.length} pedidos no período` : `${m.clientes.length} clientes · ${m.pedidos.length} pedidos no período`;
  const icon = L.divIcon({
    className: 'mapa-bolha-wrap',
    html: `<div class="mapa-bolha" style="width:${d}px;height:${d}px;background:${m.cor}" title="${esc(m.nome)}: ${titulo}"><b>${principal}</b><span>${esc(m.nome)}</span>${etiquetaPedidos}</div>`,
    iconSize: [d, d],
    iconAnchor: [d / 2, d / 2],
  });
  return { icon, diametro: d };
}

/** Agrupa clientes e pedidos por município, com cor fixa e centro geométrico. */
function agruparMunicipios(dados: RespostaMapa): Map<string, Municipio> {
  const mapa = new Map<string, Municipio>();
  const nomes = new Map<string, string>(); // chave normalizada → nome exibido
  for (const c of dados.clientes) nomes.set(chaveMunicipio(c.cidade), nomeMunicipio(c.cidade));
  for (const p of dados.pedidos) nomes.set(chaveMunicipio(p.cidade), nomeMunicipio(p.cidade));
  const ordenados = [...nomes.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  ordenados.forEach((chave, i) => mapa.set(chave, { nome: nomes.get(chave)!, cor: PALETA[i % PALETA.length], clientes: [], pedidos: [], centro: [0, 0] }));
  for (const c of dados.clientes) mapa.get(chaveMunicipio(c.cidade))!.clientes.push(c);
  for (const p of dados.pedidos) mapa.get(chaveMunicipio(p.cidade))!.pedidos.push(p);
  for (const m of mapa.values()) {
    const pts = [...m.clientes, ...m.pedidos];
    m.centro = [pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lng, 0) / pts.length];
  }
  return mapa;
}

export function Mapa() {
  const [params, setParams] = useSearchParams();
  const modo = (params.get('modo') as Modo) || 'ambos';
  const periodo = (params.get('periodo') as Periodo) || '7';
  const statusSel = useMemo(() => (params.get('status') ?? '').split(',').filter(Boolean), [params]);

  const [dados, setDados] = useState<RespostaMapa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState(false);
  const [municipioSel, setMunicipioSel] = useState<string | null>(null);
  const [mostrarSemLoc, setMostrarSemLoc] = useState(false);
  const [buscaPainel, setBuscaPainel] = useState('');

  const mapaRef = useRef<L.Map | null>(null);
  const camadaPinosRef = useRef<L.LayerGroup | null>(null);
  const camadaBolhasRef = useRef<L.LayerGroup | null>(null);
  const marcadoresRef = useRef<Map<string, L.Marker>>(new Map());
  const divRef = useRef<HTMLDivElement | null>(null);
  const ajustouRef = useRef(false);
  const modoAnteriorRef = useRef<Modo | null>(null);
  const bolhasInfoRef = useRef<{ marcador: L.Marker; centro: [number, number]; diametro: number }[]>([]);
  const pinosBaseRef = useRef<{ marcador: L.Marker; base: L.LatLng }[]>([]);

  /**
   * Pinos na mesma coordenada (mesmo CEP, precisão de rua) ficariam um em cima
   * do outro: espalha cada grupo num círculo pequeno, em pixels, recalculado
   * a cada zoom para o círculo ter sempre o mesmo tamanho na tela.
   */
  const espalharPinos = () => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    const grupos = new Map<string, { marcador: L.Marker; base: L.LatLng }[]>();
    for (const p of pinosBaseRef.current) {
      const k = `${p.base.lat.toFixed(5)},${p.base.lng.toFixed(5)}`;
      const g = grupos.get(k);
      if (g) g.push(p);
      else grupos.set(k, [p]);
    }
    // Só espalha com zoom perto; afastado, empilhar é o normal e a bolha dá a contagem.
    const espalhar = mapa.getZoom() >= 15;
    for (const g of grupos.values()) {
      if (g.length === 1 || !espalhar) {
        for (const p of g) p.marcador.setLatLng(p.base);
        continue;
      }
      // Espiral compacta (ângulo áureo): 133 pinos cabem num miolo de ~130 px de raio.
      const centro = mapa.latLngToLayerPoint(g[0].base);
      g.forEach((p, i) => {
        const ang = i * 2.39996;
        const raio = i === 0 ? 0 : 11 * Math.sqrt(i) + 10;
        p.marcador.setLatLng(mapa.layerPointToLatLng(L.point(centro.x + Math.cos(ang) * raio, centro.y + Math.sin(ang) * raio)));
      });
    }
  };

  /**
   * Coloca cada bolha no ponto livre mais próximo do centro do município:
   * testa o próprio centro e depois anéis de 8 direções, até achar um lugar
   * sem pino (nem outra bolha) por baixo. Tudo em pixels da tela atual.
   */
  const posicionarBolhas = () => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    const pinos = [...marcadoresRef.current.values()].map((m) => mapa.latLngToLayerPoint(m.getLatLng()));
    const ocupadas: { p: L.Point; r: number }[] = [];
    const FOLGA_PINO = 22; // metade da altura do alfinete, aproximada
    for (const b of bolhasInfoRef.current) {
      const raio = b.diametro / 2;
      const centro = mapa.latLngToLayerPoint(L.latLng(b.centro));
      const livre = (p: L.Point) =>
        pinos.every((q) => p.distanceTo(q) > raio + FOLGA_PINO) && ocupadas.every((o) => p.distanceTo(o.p) > raio + o.r + 6);
      let escolhido = centro;
      if (!livre(centro)) {
        // Só perto do centro (3 anéis): longe demais a bolha deixa de "ser" o município.
        // Sem lugar livre por perto, fica no centro mesmo, por cima dos pinos.
        busca: for (let anel = 1; anel <= 3; anel++) {
          const dist = raio + anel * 26;
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2 + (anel % 2) * (Math.PI / 8);
            const cand = L.point(centro.x + Math.cos(ang) * dist, centro.y + Math.sin(ang) * dist);
            if (livre(cand)) {
              escolhido = cand;
              break busca;
            }
          }
        }
      }
      ocupadas.push({ p: escolhido, r: raio });
      b.marcador.setLatLng(mapa.layerPointToLatLng(escolhido));
    }
  };

  const municipios = useMemo(() => (dados ? agruparMunicipios(dados) : new Map<string, Municipio>()), [dados]);

  const atualizarParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
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
    mapa.createPane('bolhas').style.zIndex = '650'; // bolhas acima dos pinos
    const pinos = L.layerGroup().addTo(mapa);
    const bolhas = L.layerGroup().addTo(mapa);
    // Perto do chão a bolha só atrapalha: some acima do zoom 14 e volta ao afastar.
    mapa.on('zoomend', () => {
      const perto = mapa.getZoom() > 14;
      if (perto && mapa.hasLayer(bolhas)) mapa.removeLayer(bolhas);
      if (!perto && !mapa.hasLayer(bolhas)) mapa.addLayer(bolhas);
    });
    // A posição livre depende da escala: recalcula a cada zoom/arraste.
    mapa.on('zoomend moveend', () => posicionarBolhas());
    mapa.on('zoomend', () => espalharPinos());
    mapaRef.current = mapa;
    camadaPinosRef.current = pinos;
    camadaBolhasRef.current = bolhas;
    return () => {
      mapa.remove();
      mapaRef.current = null;
      camadaPinosRef.current = null;
      camadaBolhasRef.current = null;
    };
  }, []);

  // Redesenha pinos e bolhas quando dados/modo mudam.
  useEffect(() => {
    const mapa = mapaRef.current;
    const pinos = camadaPinosRef.current;
    const bolhas = camadaBolhasRef.current;
    if (!mapa || !pinos || !bolhas || !dados) return;
    pinos.clearLayers();
    bolhas.clearLayers();
    marcadoresRef.current.clear();
    pinosBaseRef.current = [];
    const pontos: L.LatLngExpression[] = [];

    if (modo !== 'pedidos') {
      for (const c of dados.clientes) {
        const cor = municipios.get(chaveMunicipio(c.cidade))?.cor ?? '#6b7280';
        const m = L.marker([c.lat, c.lng], { icon: iconePino(cor, '#1f2937') });
        m.bindPopup(
          `<div class="popup-mapa">
             <strong>${esc(c.nome)}</strong><br>
             <span class="mono">${esc(fmtDocumento(c.documento))}</span><br>
             ${esc(c.endereco)} - ${esc(c.bairro)}, ${esc(c.cidade)}<br>
             ${c.precisao === 'cep' ? '<small>Localização aproximada pelo CEP</small><br>' : ''}
             <a href="/clientes?busca=${encodeURIComponent(c.documento)}">Abrir cliente</a>
           </div>`,
        );
        pinos.addLayer(m);
        marcadoresRef.current.set('c:' + c.id, m);
        pinosBaseRef.current.push({ marcador: m, base: L.latLng(c.lat, c.lng) });
        pontos.push([c.lat, c.lng]);
      }
    }
    if (modo !== 'clientes') {
      for (const p of dados.pedidos) {
        const m = L.marker([p.lat, p.lng], { icon: iconePino('#FFD500', COR_BORDA[p.status] ?? '#1a1a1a', 32), zIndexOffset: 100 });
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
        pinos.addLayer(m);
        marcadoresRef.current.set('p:' + p.id, m);
        pinosBaseRef.current.push({ marcador: m, base: L.latLng(p.lat, p.lng) });
        pontos.push([p.lat, p.lng]);
      }
    }
    bolhasInfoRef.current = [];
    for (const mun of municipios.values()) {
      const n = modo === 'clientes' ? mun.clientes.length : modo === 'pedidos' ? mun.pedidos.length : Math.max(mun.clientes.length, mun.pedidos.length);
      if (n < MIN_BOLHA) continue;
      const { icon, diametro } = iconeBolha(mun, modo);
      const b = L.marker(mun.centro, { icon, pane: 'bolhas', interactive: true });
      b.on('click', () => {
        setMunicipioSel(chaveMunicipio(mun.nome));
        setMostrarSemLoc(false);
        setBuscaPainel('');
      });
      bolhas.addLayer(b);
      bolhasInfoRef.current.push({ marcador: b, centro: mun.centro, diametro });
    }
    espalharPinos();
    posicionarBolhas();
    if (pontos.length) {
      if (!ajustouRef.current || modoAnteriorRef.current !== modo) {
        mapa.fitBounds(L.latLngBounds(pontos), { padding: [30, 30], maxZoom: 15 });
        ajustouRef.current = true;
        modoAnteriorRef.current = modo;
      }
    } else {
      mapa.setView(CENTRO_PADRAO, 12);
      ajustouRef.current = false; // filtro sem pontos: re-enquadra quando voltarem
    }
  }, [dados, modo, municipios]);

  // O painel abre em cima do mapa; avisa o Leaflet que a área mudou.
  useEffect(() => {
    mapaRef.current?.invalidateSize();
  }, [municipioSel, mostrarSemLoc]);

  const geocodificar = async (refazer = false) => {
    if (refazer && !confirm('Apagar todas as coordenadas deste cliente e geocodificar tudo de novo? Leva cerca de 1 segundo por endereço.')) return;
    setDisparando(true);
    try {
      await api('/admin/mapa/geocodificar' + (refazer ? '?refazer=1' : ''), { method: 'POST' });
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

  const focar = (chave: string, lat: number, lng: number) => {
    const mapa = mapaRef.current;
    const m = marcadoresRef.current.get(chave);
    if (!mapa) return;
    mapa.setView([lat, lng], Math.max(mapa.getZoom(), 16));
    m?.openPopup();
  };

  const emAndamento = dados?.geocodificacao.emAndamento ?? false;
  const semLoc = dados?.semLocalizacao;
  const mun = municipioSel ? municipios.get(municipioSel) : undefined;
  const filtro = normalizar(buscaPainel);
  const clientesPainel = mun && modo !== 'pedidos'
    ? mun.clientes.filter((c) => !filtro || normalizar(`${c.nome} ${c.bairro} ${c.documento}`).includes(filtro)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    : [];
  const pedidosPainel = mun && modo !== 'clientes'
    ? mun.pedidos.filter((p) => !filtro || normalizar(`${p.numero} ${p.cliente} ${p.bairro}`).includes(filtro))
    : [];

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
          <button className={`mapa-aviso ${mostrarSemLoc ? 'ativo' : ''}`} onClick={() => { setMostrarSemLoc(!mostrarSemLoc); setMunicipioSel(null); setBuscaPainel(''); }} title="Ver quem ficou sem localização">
            {semLoc.clientes} cliente{semLoc.clientes === 1 ? '' : 's'} / {semLoc.pedidos} pedido{semLoc.pedidos === 1 ? '' : 's'} sem localização
          </button>
        )}
        <button className="btn btn-claro" onClick={() => geocodificar(false)} disabled={emAndamento || disparando}>
          {emAndamento ? 'Geocodificando…' : 'Geocodificar pendentes'}
        </button>
        <button className="btn btn-claro btn-mini" onClick={() => geocodificar(true)} disabled={emAndamento || disparando} title="Zera as coordenadas e geocodifica todos os endereços de novo (use após corrigir CEPs ou trocar a fonte)">
          Refazer tudo
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
        <span><i className="mapa-ponto cliente" /> Cliente (cor = município)</span>
        <span><i className="mapa-ponto pedido" /> Pedido (borda = status)</span>
        <span><i className="mapa-ponto bolha" /> Município: clique para ver a lista</span>
        {!dados && !erro && <span className="vazio">Carregando…</span>}
      </div>
      <div className="mapa-area">
        <div ref={divRef} className="mapa-wrap" />
        {mun && (
          <aside className="mapa-painel">
            <div className="mapa-painel-cab" style={{ borderColor: mun.cor }}>
              <div>
                <strong>{mun.nome}</strong>
                <div className="sub">
                  {modo !== 'pedidos' && `${mun.clientes.length} cliente${mun.clientes.length === 1 ? '' : 's'}`}
                  {modo === 'ambos' && ' · '}
                  {modo !== 'clientes' && `${mun.pedidos.length} pedido${mun.pedidos.length === 1 ? '' : 's'}`}
                </div>
              </div>
              <button className="btn btn-mini btn-claro" onClick={() => setMunicipioSel(null)} title="Fechar">✕</button>
            </div>
            <input placeholder="Buscar nome, bairro, documento…" value={buscaPainel} onChange={(e) => setBuscaPainel(e.target.value)} />
            <div className="mapa-painel-lista">
              {clientesPainel.map((c) => (
                <button key={c.id} className="mapa-painel-item" onClick={() => focar('c:' + c.id, c.lat, c.lng)}>
                  <strong>{c.nome}</strong>
                  <span className="sub">{c.bairro} · {fmtDocumento(c.documento)}</span>
                </button>
              ))}
              {pedidosPainel.map((p) => (
                <button key={p.id} className="mapa-painel-item" onClick={() => focar('p:' + p.id, p.lat, p.lng)}>
                  <strong>#{p.numero} · {p.cliente}</strong>
                  <span className="sub"><span className={`badge ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span> {fmtMoeda(p.total)} · {p.bairro}</span>
                </button>
              ))}
              {!clientesPainel.length && !pedidosPainel.length && <div className="vazio">Nada encontrado</div>}
            </div>
          </aside>
        )}
        {mostrarSemLoc && semLoc && (
          <aside className="mapa-painel">
            <div className="mapa-painel-cab" style={{ borderColor: '#c02626' }}>
              <div>
                <strong>Sem localização</strong>
                <div className="sub">{semLoc.listaClientes.length} cliente{semLoc.listaClientes.length === 1 ? '' : 's'} · confira CEP e endereço no cadastro</div>
              </div>
              <button className="btn btn-mini btn-claro" onClick={() => setMostrarSemLoc(false)} title="Fechar">✕</button>
            </div>
            <input placeholder="Buscar nome, CEP, documento…" value={buscaPainel} onChange={(e) => setBuscaPainel(e.target.value)} />
            <div className="mapa-painel-lista">
              {semLoc.listaClientes
                .filter((c) => !filtro || normalizar(`${c.nome} ${c.cep ?? ''} ${c.documento} ${c.endereco ?? ''}`).includes(filtro))
                .map((c) => (
                  <a key={c.id} className="mapa-painel-item" href={`/clientes?busca=${encodeURIComponent(c.documento)}`} title="Abrir cliente">
                    <strong>{c.nome}</strong>
                    <span className="sub">{c.cep ? `CEP ${c.cep}` : 'Sem endereço cadastrado'}{c.endereco ? ` · ${c.endereco}` : ''}</span>
                    <span className="sub">{fmtDocumento(c.documento)}{c.tentativas >= 5 ? ' · esgotou as tentativas' : c.tentativas ? ` · ${c.tentativas} tentativa${c.tentativas === 1 ? '' : 's'}` : ' · ainda não tentado'}</span>
                  </a>
                ))}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
