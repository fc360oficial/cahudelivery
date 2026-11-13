import 'server-only';

export class ErroApi extends Error {
  constructor(public readonly status: number, mensagem: string, public readonly codigo?: string) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export interface OpcoesApi {
  metodo?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  corpo?: unknown;
  /** Segundos de cache. Ausente = sem cache (dados do cliente). */
  revalidar?: number;
  deviceId?: string;
  /** Access token do cliente logado (vira Authorization: Bearer). */
  token?: string;
  /** IP do visitante, para o limite de tentativas da API (vira X-Forwarded-For). Só em auth/*. */
  ipCliente?: string;
}

const base = () => (process.env.API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const tenant = () => process.env.TENANT ?? 'cahu';

/** Slug do tenant deste site (o mesmo do X-Tenant). */
export const tenantDoSite = (): string => tenant();

/** Única porta do site para a API /v1. Só roda no servidor. */
export async function chamarApi<T>(caminho: string, op: OpcoesApi = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Tenant': tenant(), Accept: 'application/json' };
  if (op.deviceId) headers['X-Device-Id'] = op.deviceId;
  if (op.token) headers.Authorization = `Bearer ${op.token}`;
  if (op.ipCliente) headers['X-Forwarded-For'] = op.ipCliente;
  if (op.corpo !== undefined) headers['Content-Type'] = 'application/json';

  const init: RequestInit & { next?: { revalidate: number } } = {
    method: op.metodo ?? 'GET',
    headers,
    body: op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined,
  };
  if (op.revalidar !== undefined) init.next = { revalidate: op.revalidar };
  else init.cache = 'no-store';

  let resp: Response;
  try {
    resp = await fetch(`${base()}${caminho}`, init);
  } catch {
    throw new ErroApi(503, 'Não foi possível falar com o servidor. Tente novamente.');
  }

  if (!resp.ok) {
    let mensagem = 'Erro inesperado. Tente novamente.';
    let codigo: string | undefined;
    try {
      const j = (await resp.json()) as { message?: unknown; codigo?: unknown };
      const m = Array.isArray(j?.message) ? j.message.join('. ') : j?.message;
      if (typeof m === 'string' && m) mensagem = m;
      if (typeof j?.codigo === 'string' && j.codigo) codigo = j.codigo;
    } catch {
      // corpo não era JSON: fica a mensagem padrão
    }
    throw new ErroApi(resp.status, mensagem, codigo);
  }
  return (await resp.json()) as T;
}

/** Teto de tamanho de arquivo repassado (DANFE/XML de NF-e ficam bem abaixo disto). */
const LIMITE_ARQUIVO = 10 * 1024 * 1024;

/**
 * Baixa um arquivo da API (DANFE/XML), sempre do API_URL do servidor, sem cache e sem seguir
 * redirecionamento. Erro vira ErroApi só com o status (o corpo da API não é repassado).
 */
export async function baixarArquivoApi(caminho: string): Promise<{ corpo: ArrayBuffer; tipo: string | null }> {
  let resp: Response;
  try {
    resp = await fetch(`${base()}${caminho}`, {
      headers: { 'X-Tenant': tenant() },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ErroApi(503, 'Não foi possível falar com o servidor. Tente novamente.');
  }
  if (!resp.ok) throw new ErroApi(resp.status, 'Arquivo indisponível.');
  const tamanho = Number(resp.headers.get('content-length') ?? 0);
  if (tamanho > LIMITE_ARQUIVO) throw new ErroApi(502, 'Arquivo grande demais.');
  const corpo = await resp.arrayBuffer();
  if (corpo.byteLength > LIMITE_ARQUIVO) throw new ErroApi(502, 'Arquivo grande demais.');
  return { corpo, tipo: resp.headers.get('content-type') };
}
