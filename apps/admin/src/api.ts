/** Cliente da API admin: injeta X-Tenant e Bearer; 401 derruba para o login. */
const TENANT = import.meta.env.VITE_TENANT ?? 'cahu';
const API_URL = import.meta.env.VITE_API_URL ?? `http://${location.hostname}:3000/v1`;

export interface Sessao {
  accessToken: string;
  nome: string;
  papel: string;
  distribuidora: string;
  /** Soluções a que o usuário tem acesso. Sessões antigas não têm: ver solucoesDaSessao(). */
  solucoes?: Solucao[];
  /** Solução em que o usuário está agora (atualizada pela rota). */
  solucaoAtual?: Solucao;
}

export type Solucao = 'delivery' | 'vendas';

/** Lista efetiva de soluções: sessão antiga SEM lista = só Delivery; lista vazia fica vazia; admin = as duas. */
export function solucoesDaSessao(s: Sessao | null = sessao()): Solucao[] {
  if (!s) return [];
  if (s.papel === 'admin') return ['delivery', 'vendas'];
  const l = (s.solucoes ?? ['delivery']).filter((x): x is Solucao => x === 'delivery' || x === 'vendas');
  return l;
}

/** Página inicial de cada solução. */
export const HOME_DA_SOLUCAO: Record<Solucao, string> = { delivery: '/', vendas: '/vendas' };

/** Solução atual (a salva na sessão, se o usuário ainda tiver acesso; senão a primeira dele). */
export function solucaoAtual(s: Sessao | null = sessao()): Solucao | null {
  const lista = solucoesDaSessao(s);
  if (!s || !lista.length) return null;
  return s.solucaoAtual && lista.includes(s.solucaoAtual) ? s.solucaoAtual : lista[0];
}

/** Troca a solução atual e persiste na sessão. */
export function trocarSolucao(sol: Solucao) {
  const s = sessao();
  if (!s || s.solucaoAtual === sol) return;
  salvarSessao({ ...s, solucaoAtual: sol });
}

/** Para onde mandar o usuário logo após o login: uma solução = direto; mais de uma = escolha. */
export function destinoInicial(s: Sessao | null = sessao()): string {
  const lista = solucoesDaSessao(s);
  return lista.length === 1 ? HOME_DA_SOLUCAO[lista[0]] : '/solucoes';
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
  return (await uploadCompleto(arquivo)).url;
}

/** tipo='produto' → a API padroniza a foto (quadrado 1000x1000 fundo branco) e devolve também a miniatura. */
export async function uploadCompleto(arquivo: File, tipo?: 'produto' | 'categoria'): Promise<{ url: string; urlMiniatura?: string }> {
  const s = sessao();
  const fd = new FormData();
  fd.append('arquivo', arquivo);
  const res = await fetch(`${API_URL}/admin/upload${tipo ? `?tipo=${tipo}` : ''}`, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}) },
    body: fd,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message ?? 'Falha no upload');
  return body as { url: string; urlMiniatura?: string };
}

/** POST multipart (fotos + campos) numa rota da API admin. */
export async function apiForm<T = unknown>(path: string, fd: FormData): Promise<T> {
  const s = sessao();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}) },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join('\n') : body?.message ?? `Erro ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

/**
 * Imagem de rota autenticada (ex.: foto do canhoto, que não é pública): baixa
 * com o token e devolve um blob: URL pro <img>. Quem chama revoga quando sair.
 */
export async function apiImagem(path: string): Promise<string> {
  const s = sessao();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'X-Tenant': TENANT, ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}) },
  });
  if (!res.ok) throw new Error(`Foto indisponível (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

export const fmtMoeda = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtDocumento = (v: string | null | undefined) => {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
};

export const fmtData = (v: string) =>
  new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const PAGAMENTO_LABEL: Record<string, string> = {
  pix: 'PIX',
  cartao: 'Cartão na entrega',
  boleto: 'Boleto',
};

export const STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  RECEBIDO: 'Recebido',
  ENVIADO_ERP: 'Enviado ao ERP',
  ABERTO: 'Aberto',
  EM_FATURAMENTO: 'Em faturamento',
  FATURADO: 'Faturado',
  EM_SEPARACAO: 'Em separação',
  SAIU_ENTREGA: 'Saiu p/ entrega',
  ENTREGUE: 'Entregue',
  FALHA_INTEGRACAO: 'Falha integração',
  CANCELADO: 'Cancelado',
};
