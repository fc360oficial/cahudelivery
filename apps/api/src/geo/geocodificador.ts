/**
 * Endereço → coordenada, sem chave e sem custo.
 *
 * 0) ViaCEP normaliza o endereço a partir do CEP (rua, bairro, cidade, UF limpos) —
 *    o cadastro costuma vir com UF em branco, cidade com erro de digitação, número "0".
 * 1..5) Cascata no Nominatim (OpenStreetMap), da mais precisa para a menos:
 *    rua+número → rua → busca livre "rua, bairro, cidade, UF" → bairro → CEP.
 * A BrasilAPI foi descartada: devolve o centro do município para muitos CEPs.
 * Nunca lança: erro de rede ou resposta vazia devolve null.
 */
export interface EnderecoGeo {
  cep: string;
  logradouro: string;
  numero: string;
  bairro?: string;
  cidade: string;
  uf: string;
}

export interface Coordenada {
  lat: number;
  lng: number;
  /** 'endereco' = rua (com ou sem número); 'cep' = aproximada (CEP ou bairro). */
  precisao: 'cep' | 'endereco';
  /** Município segundo o OpenStreetMap (o campo cidade do cadastro não é confiável). */
  cidade: string | null;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type EsperarFn = (ms: number) => Promise<void>;

export const USER_AGENT = 'FluxoCommerce/1.0 (contato@fluxocerto.com.br)';
const TIMEOUT_MS = 8_000;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const VIACEP = 'https://viacep.com.br/ws';
const INTERVALO_MS = 1_000; // Nominatim: no máximo 1 requisição por segundo
const dormir: EsperarFn = (ms) => new Promise((r) => setTimeout(r, ms));

export async function geocodificar(end: EnderecoGeo, fetchFn: FetchFn = fetch, esperar: EsperarFn = dormir): Promise<Coordenada | null> {
  const cep = end.cep.replace(/\D/g, '');
  const cepFormatado = cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null;
  const via = cepFormatado ? await viaCep(cep, fetchFn) : null;

  // Cadastro limpo pelo ViaCEP quando ele responde; senão fica o que veio.
  const rua = limpar(via?.logradouro || end.logradouro);
  const bairro = limpar(via?.bairro || end.bairro || '');
  const cidade = limpar(via?.localidade || end.cidade);
  const uf = limpar(via?.uf || end.uf).toUpperCase();
  const numero = extrairNumero(end.numero, end.logradouro);

  const local = semVazios({ city: cidade, state: uf });
  const sufixo = [bairro, cidade, uf].filter(Boolean).join(', ');
  const etapas: { filtros: Record<string, string>; precisao: Coordenada['precisao'] }[] = [];
  if (rua && cidade) {
    if (numero) etapas.push({ filtros: { street: `${numero} ${rua}`, ...local }, precisao: 'endereco' });
    etapas.push({ filtros: { street: rua, ...local }, precisao: 'endereco' });
    etapas.push({ filtros: { q: `${rua}, ${sufixo}` }, precisao: 'endereco' });
  }
  if (bairro && cidade) etapas.push({ filtros: { q: sufixo }, precisao: 'cep' });
  if (cepFormatado) etapas.push({ filtros: { postalcode: cepFormatado }, precisao: 'cep' });

  for (let i = 0; i < etapas.length; i++) {
    if (i > 0) await esperar(INTERVALO_MS);
    const c = await nominatim(etapas[i].filtros, etapas[i].precisao, fetchFn);
    if (c) return c;
  }
  return null;
}

function limpar(s: string | undefined) {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function semVazios(o: Record<string, string>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v));
}

/** "0", vazio e "S/N" não são número; "AV X,391" no logradouro conta como 391. */
function extrairNumero(numero: string, logradouro: string): string {
  const n = limpar(numero);
  if (n && n !== '0' && !/^s\/?n$/i.test(n)) return n;
  const m = /,\s*(\d{1,6})\s*$/.exec(logradouro);
  return m ? m[1] : '';
}

interface ViaCep {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

async function viaCep(cep: string, fetchFn: FetchFn): Promise<ViaCep | null> {
  try {
    const res = await fetchFn(`${VIACEP}/${cep}/json/`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as ViaCep;
    return body && !body.erro ? body : null;
  } catch {
    return null;
  }
}

async function nominatim(
  filtros: Record<string, string>,
  precisao: Coordenada['precisao'],
  fetchFn: FetchFn,
): Promise<Coordenada | null> {
  const q = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', addressdetails: '1', ...filtros });
  try {
    const res = await fetchFn(`${NOMINATIM}?${q}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ lat: string; lon: string; address?: Record<string, string> }>;
    const hit = body[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    const a = hit.address ?? {};
    const cidade = a.city ?? a.town ?? a.municipality ?? a.village ?? null;
    return { lat, lng, precisao, cidade };
  } catch {
    return null;
  }
}
