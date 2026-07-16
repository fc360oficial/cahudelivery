/** Cliente da API admin: injeta X-Tenant e Bearer; 401 derruba para o login. */
const TENANT = import.meta.env.VITE_TENANT ?? 'cahu';
const API_URL = import.meta.env.VITE_API_URL ?? `http://${location.hostname}:3000/v1`;

export interface Sessao {
  accessToken: string;
  nome: string;
  papel: string;
  distribuidora: string;
}

export function sessao(): Sessao | null {
  const raw = localStorage.getItem('sessao');
  return raw ? (JSON.parse(raw) as Sessao) : null;
}

export function salvarSessao(s: Sessao) {
  localStorage.setItem('sessao', JSON.stringify(s));
}

export function sair() {
  localStorage.removeItem('sessao');
  location.href = '/login';
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const s = sessao();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'X-Tenant': TENANT,
      'Content-Type': 'application/json',
      ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && location.pathname !== '/login') {
    sair();
    throw new Error('Sessão expirada');
  }
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join('\n') : body?.message ?? `Erro ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

/** Envia uma imagem (banner, foto de produto) e devolve a URL pública. */
export async function upload(arquivo: File): Promise<string> {
  const s = sessao();
  const fd = new FormData();
  fd.append('arquivo', arquivo);
  const res = await fetch(`${API_URL}/admin/upload`, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}) },
    body: fd,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message ?? 'Falha no upload');
  return body.url as string;
}

export const fmtMoeda = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtData = (v: string) =>
  new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const STATUS_LABEL: Record<string, string> = {
  RECEBIDO: 'Recebido',
  ENVIADO_ERP: 'No ERP',
  FATURADO: 'Faturado',
  EM_SEPARACAO: 'Em separação',
  SAIU_ENTREGA: 'Saiu p/ entrega',
  ENTREGUE: 'Entregue',
  FALHA_INTEGRACAO: 'Falha integração',
  CANCELADO: 'Cancelado',
};
