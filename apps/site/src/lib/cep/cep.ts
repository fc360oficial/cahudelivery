/** Partes puras da busca de CEP: formato, lista branca da resposta do ViaCEP e cache em memória. */

export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** Código IBGE do município (7 dígitos); nulo quando o ViaCEP não mandou um válido. */
  codigoMunicipio: string | null;
}

/** Exatamente 8 dígitos, nada mais: é o único texto do visitante que entra na URL do ViaCEP. */
export function cepExato(v: unknown): string | null {
  return typeof v === 'string' && /^\d{8}$/.test(v) ? v : null;
}

const curto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Só logradouro, bairro, cidade, UF e código do município saem; CEP inexistente ou resposta estranha = nulo. */
export function extrairEndereco(dados: unknown): EnderecoCep | null {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  if (d.erro === true || d.erro === 'true') return null;
  const uf = curto(d.uf, 3).toUpperCase();
  const cidade = curto(d.localidade, 80);
  // Sem cidade ou UF a resposta não serve (serviço degradado): tratar como não encontrado, e não guardar.
  if (!cidade || !/^[A-Z]{2}$/.test(uf)) return null;
  return {
    logradouro: curto(d.logradouro, 120),
    bairro: curto(d.bairro, 80),
    cidade,
    uf,
    codigoMunicipio: typeof d.ibge === 'string' && /^\d{7}$/.test(d.ibge.trim()) ? d.ibge.trim() : null,
  };
}

export interface CacheCep<T> {
  ler(cep: string, agoraMs: number): T | undefined;
  gravar(cep: string, valor: T, agoraMs: number): void;
  tamanho(): number;
}

/** Cache por CEP na memória do processo, com validade e teto de entradas (a mais antiga sai primeiro). */
export function criarCacheCep<T>(op: { validadeMs: number; maximoDeEntradas: number }): CacheCep<T> {
  const entradas = new Map<string, { valor: T; venceEm: number }>();
  const limparVencidas = (agoraMs: number) => {
    for (const [cep, e] of entradas) if (e.venceEm <= agoraMs) entradas.delete(cep);
  };
  return {
    ler(cep, agoraMs) {
      const e = entradas.get(cep);
      if (!e) return undefined;
      if (e.venceEm <= agoraMs) {
        entradas.delete(cep);
        return undefined;
      }
      return e.valor;
    },
    gravar(cep, valor, agoraMs) {
      entradas.delete(cep);
      if (entradas.size >= op.maximoDeEntradas) limparVencidas(agoraMs);
      while (entradas.size >= op.maximoDeEntradas) entradas.delete(entradas.keys().next().value as string);
      entradas.set(cep, { valor, venceEm: agoraMs + op.validadeMs });
    },
    tamanho: () => entradas.size,
  };
}
