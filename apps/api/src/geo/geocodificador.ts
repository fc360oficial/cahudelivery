/**
 * Endereço → coordenada, sem chave e sem custo.
 * 1) BrasilAPI pelo CEP (precisão de rua/bairro).
 * 2) Nominatim (OpenStreetMap) pelo endereço completo.
 * Nunca lança: erro de rede ou resposta vazia devolve null.
 */
export interface EnderecoGeo {
  cep: string;
  logradouro: string;
  numero: string;
  cidade: string;
  uf: string;
}

export interface Coordenada {
  lat: number;
  lng: number;
  precisao: 'cep' | 'endereco';
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = 'FluxoCommerce/1.0 (contato@fluxocerto.com.br)';
const TIMEOUT_MS = 8_000;

export async function geocodificar(end: EnderecoGeo, fetchFn: FetchFn = fetch): Promise<Coordenada | null> {
  const porCep = await viaBrasilApi(end, fetchFn);
  if (porCep) return porCep;
  return viaNominatim(end, fetchFn);
}

async function viaBrasilApi(end: EnderecoGeo, fetchFn: FetchFn): Promise<Coordenada | null> {
  const cep = end.cep.replace(/\D/g, '');
  if (cep.length !== 8) return null;
  try {
    const res = await fetchFn(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { location?: { coordinates?: { latitude?: string; longitude?: string } } };
    const c = body.location?.coordinates;
    const lat = Number(c?.latitude);
    const lng = Number(c?.longitude);
    if (!c?.latitude || !c?.longitude || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, precisao: 'cep' };
  } catch {
    return null;
  }
}

async function viaNominatim(end: EnderecoGeo, fetchFn: FetchFn): Promise<Coordenada | null> {
  const q = new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: 'br',
    street: `${end.numero} ${end.logradouro}`.trim(),
    city: end.cidade,
    state: end.uf,
  });
  try {
    const res = await fetchFn(`https://nominatim.openstreetmap.org/search?${q}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = body[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, precisao: 'endereco' };
  } catch {
    return null;
  }
}
