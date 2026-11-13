import 'server-only';
import { cepExato, extrairEndereco, type EnderecoCep } from './cep';

export type ResultadoCep =
  | { tipo: 'encontrado'; endereco: EnderecoCep }
  | { tipo: 'nao-encontrado' }
  | { tipo: 'invalido' }
  | { tipo: 'falha' };

const TEMPO_LIMITE_MS = 6000;

/**
 * Busca de CEP igual à do app (ViaCEP), feita pelo servidor do site: o navegador só fala com /api
 * (CSP connect-src 'self'). Host fixo, só o CEP de 8 dígitos entra na URL, sem seguir
 * redirecionamento, com tempo limite e sem cache do fetch (o cache de fetch do Next junto com o
 * AbortSignal fazia a busca falhar no next dev). A resposta passa pela lista branca de extrairEndereco.
 */
export async function consultarCep(cep: string): Promise<ResultadoCep> {
  const valido = cepExato(cep);
  if (!valido) return { tipo: 'invalido' };
  let dados: unknown;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${valido}/json/`, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!r.ok) return { tipo: 'falha' };
    dados = await r.json();
  } catch {
    return { tipo: 'falha' };
  }
  const endereco = extrairEndereco(dados);
  return endereco ? { tipo: 'encontrado', endereco } : { tipo: 'nao-encontrado' };
}
