/**
 * Município → código IBGE, sem chave e sem custo, pela API de localidades do IBGE.
 *
 * O ViaCEP já devolve o código na busca de CEP do app, então este caminho só é
 * usado quando ele não veio: ViaCEP fora do ar, CEP genérico de cidade pequena,
 * ou endereço antigo que entrou no banco antes deste recurso existir.
 *
 * Nunca lança: falha de rede devolve null.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const TIMEOUT_MS = 8_000;

interface MunicipioIbge {
  id: number;
  nome: string;
}

/** "Olho d'Água" e "OLHO DAGUA" viram a mesma chave. */
export function normalizarNomeMunicipio(nome: string): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Municípios de uma UF, indexados pelo nome normalizado.
 * `null` é falha (rede, HTTP ou lista vazia) — diferente de um mapa sem a cidade
 * procurada, que significa "o IBGE respondeu e essa cidade não existe nessa UF".
 */
export async function municipiosDaUf(uf: string, fetchFn: FetchFn = fetch): Promise<Map<string, string> | null> {
  try {
    const res = await fetchFn(`${IBGE}/${uf.trim().toUpperCase()}/municipios`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as MunicipioIbge[];
    if (!Array.isArray(body) || body.length === 0) return null;
    const mapa = new Map<string, string>();
    for (const m of body) mapa.set(normalizarNomeMunicipio(m.nome), String(m.id));
    return mapa;
  } catch {
    return null;
  }
}
