import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../../api';
import { Cartao } from '../../vendas-ui';

/** GET/PUT /admin/entregas/cd (apps/api/src/entregas/cd-entregas.ts). */
interface Cd {
  logradouro: string; numero: string; bairro: string; cidade: string; uf: string; cep: string;
  latitude: number; longitude: number; precisao: 'endereco' | 'cep' | 'manual';
}

const VAZIO = { logradouro: '', numero: '', bairro: '', cidade: 'Recife', uf: 'PE', cep: '' };
const PRECISAO: Record<Cd['precisao'], string> = {
  endereco: 'ponto achado pela rua e número',
  cep: 'ponto aproximado (pelo bairro ou CEP): arraste o pino até a porta do CD',
  manual: 'ponto marcado no mapa',
};

const ICONE_CD = L.divIcon({ className: '', iconSize: [46, 30], iconAnchor: [23, 15], html: '<div class="cd-pino">CD</div>' });

/** Endereço do CD: toda rota sai daqui e volta para cá. O pino pode ser arrastado para acertar a porta. */
export function EnderecoCd({ podeEditar }: { podeEditar: boolean }) {
  const [cd, setCd] = useState<Cd | null | undefined>(undefined);
  const [form, setForm] = useState(VAZIO);
  const [editando, setEditando] = useState(false);
  const [pino, setPino] = useState<[number, number] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const marcador = useRef<L.Marker | null>(null);

  useEffect(() => {
    api<{ cd: Cd | null }>('/admin/entregas/cd')
      .then((r) => { setCd(r.cd); if (r.cd) setPino([r.cd.latitude, r.cd.longitude]); else setEditando(true); })
      .catch((e: Error) => setErro(e.message));
  }, []);

  // Mapa com o pino do CD (arrastável para quem pode editar).
  useEffect(() => {
    if (!pino || !div.current) return;
    if (!mapa.current) {
      const m = L.map(div.current, { scrollWheelZoom: false }).setView(pino, 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
      const mk = L.marker(pino, { icon: ICONE_CD, draggable: podeEditar }).addTo(m);
      mk.on('dragend', () => { const p = mk.getLatLng(); setPino([p.lat, p.lng]); setAviso(null); });
      mapa.current = m;
      marcador.current = mk;
    } else {
      marcador.current?.setLatLng(pino);
      mapa.current.panTo(pino);
    }
  }, [pino, podeEditar]);
  useEffect(() => () => { mapa.current?.remove(); mapa.current = null; }, []);

  async function salvar(comPino: boolean) {
    setSalvando(true); setErro(null); setAviso(null);
    const base = cd && !editando ? { logradouro: cd.logradouro, numero: cd.numero, bairro: cd.bairro, cidade: cd.cidade, uf: cd.uf, cep: cd.cep } : form;
    try {
      const r = await api<{ cd: Cd }>('/admin/entregas/cd', {
        method: 'PUT',
        body: JSON.stringify({ ...base, ...(comPino && pino ? { latitude: pino[0], longitude: pino[1] } : {}) }),
      });
      setCd(r.cd); setPino([r.cd.latitude, r.cd.longitude]); setEditando(false);
      setAviso(comPino ? 'Ponto do CD salvo.' : 'Endereço salvo e achado no mapa. Se o pino não estiver na porta do CD, arraste e salve o ponto.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const pinoMudou = !!(cd && pino && (Math.abs(pino[0] - cd.latitude) > 1e-6 || Math.abs(pino[1] - cd.longitude) > 1e-6));

  return (
    <section className="ent-secao" aria-label="Endereço do CD">
      <div className="ent-secao-topo">
        <h2>Endereço do CD <small>toda rota sai daqui e volta para cá</small></h2>
        {cd && !editando && podeEditar && (
          <button type="button" className="cad-btn cad-btn-claro" onClick={() => { setForm({ logradouro: cd.logradouro, numero: cd.numero, bairro: cd.bairro, cidade: cd.cidade, uf: cd.uf, cep: cd.cep }); setEditando(true); }}>Mudar endereço</button>
        )}
      </div>
      <Cartao className="cd-cartao">
        {erro && <div className="cad-erro">{erro}</div>}
        {aviso && <div className="cad-ok" role="status">{aviso}</div>}
        {cd === undefined && !erro && <p className="cad-fraco">Carregando…</p>}
        {cd === null && !podeEditar && <p>O endereço do CD ainda não foi cadastrado. Peça a um administrador.</p>}
        {editando && podeEditar && (
          <form className="cad-form ent-form" onSubmit={(e) => { e.preventDefault(); void salvar(false); }}>
            {!cd && <p className="cad-ajuda" style={{ gridColumn: '1 / -1' }}>Sem o endereço do CD a rota é calculada só entre os clientes. Cadastre para a rota sair e voltar ao CD.</p>}
            <label htmlFor="cd-rua">Rua<input id="cd-rua" type="text" value={form.logradouro} onChange={(e) => setForm({ ...form, logradouro: e.target.value })} required maxLength={120} placeholder="Rua Antônio Luís Soares" /></label>
            <label htmlFor="cd-numero">Número<input id="cd-numero" type="text" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} required maxLength={20} placeholder="217" /></label>
            <label htmlFor="cd-bairro">Bairro<input id="cd-bairro" type="text" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} required maxLength={80} placeholder="Boa Viagem" /></label>
            <label htmlFor="cd-cidade">Cidade<input id="cd-cidade" type="text" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} required maxLength={80} /></label>
            <label htmlFor="cd-uf">UF<input id="cd-uf" type="text" value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} required maxLength={2} /></label>
            <label htmlFor="cd-cep">CEP (opcional)<input id="cd-cep" type="text" inputMode="numeric" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} maxLength={9} placeholder="51000-000" /></label>
            <div className="cad-acoes">
              <button className="cad-btn" disabled={salvando}>{salvando ? 'Procurando no mapa…' : 'Salvar e achar no mapa'}</button>
              {cd && <button type="button" className="cad-btn cad-btn-claro" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</button>}
            </div>
          </form>
        )}
        {cd && !editando && (
          <p className="cd-endereco"><strong>{cd.logradouro}, {cd.numero}</strong> · {cd.bairro} · {cd.cidade}/{cd.uf}<span className="cad-sub">{PRECISAO[cd.precisao]}</span></p>
        )}
        {pino && <div ref={div} className="cd-mapa" />}
        {pinoMudou && podeEditar && (
          <div className="cad-acoes">
            <button type="button" className="cad-btn" disabled={salvando} onClick={() => void salvar(true)}>Salvar o ponto marcado</button>
            <button type="button" className="cad-btn cad-btn-claro" disabled={salvando} onClick={() => setPino([cd!.latitude, cd!.longitude])}>Desfazer</button>
          </div>
        )}
      </Cartao>
    </section>
  );
}
