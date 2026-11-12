import 'server-only';

export class ErroApi extends Error {
  constructor(public readonly status: number, mensagem: string) {
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
}

const base = () => (process.env.API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const tenant = () => process.env.TENANT ?? 'cahu';

/** Única porta do site para a API /v1. Só roda no servidor. */
export async function chamarApi<T>(caminho: string, op: OpcoesApi = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Tenant': tenant(), Accept: 'application/json' };
  if (op.deviceId) headers['X-Device-Id'] = op.deviceId;
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
    try {
      const j = (await resp.json()) as { message?: unknown };
      const m = Array.isArray(j?.message) ? j.message.join('. ') : j?.message;
      if (typeof m === 'string' && m) mensagem = m;
    } catch {
      // corpo não era JSON: fica a mensagem padrão
    }
    throw new ErroApi(resp.status, mensagem);
  }
  return (await resp.json()) as T;
}
