/**
 * Endereço → coordenada, sem chave e sem custo, via Nominatim (OpenStreetMap).
 * 1) Rua + número + cidade + UF → precisão 'endereco'.
 * 2) Só o CEP → precisão 'cep' (rua/bairro).
 * A BrasilAPI foi descartada: para muitos CEPs ela devolve o centro do
 * município, o que colocava o cliente no lugar errado do mapa.
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
  /** Município segundo o OpenStreetMap (o campo cidade do cadastro não é confiável). */
  cidade: string | null;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = 'FluxoCommerce/1.0 (contato@fluxocerto.com.br)';
const TIMEOUT_MS = 8_000;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function geocodificar(end: EnderecoGeo, fetchFn: FetchFn = fetch): Promise<Coordenada | null> {
  const porRua = await nominatim(
    { street: `${end.numero} ${end.logradouro}`.trim(), city: end.cidade, state: end.uf },
    'endereco',
    fetchFn,
  );
  if (porRua) return porRua;
  const cep = end.cep.replace(/\D/g, '');
  if (cep.length !== 8) return null;
  return nominatim({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}` }, 'cep', fetchFn);
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
