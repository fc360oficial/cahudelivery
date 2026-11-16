import { criarLimite, type Limite } from '@/lib/conta/limite-tentativas';

const UM_MINUTO = 60 * 1000;
/**
 * 60 consultas de busca por minuto por IP do visitante. A busca livre não tem cache (cada termo ×
 * página × ordem seria uma entrada nova) e toda consulta chega ao banco; sem freio, um robô derruba
 * o catálogo. O teto é folgado: cada busca feita no navegador vira até 3 consultas (a página e a
 * pré-carga dos links de ordenar), trocar de página também conta, e uma loja inteira pode sair
 * pelo mesmo IP. Dá umas 20 buscas por minuto por IP, bem mais do que alguém faz à mão.
 */
export const LIMITE_BUSCA = { maximo: 60, janelaMs: UM_MINUTO };

const buscas = criarLimite(LIMITE_BUSCA);

/**
 * Conta mais uma busca do IP e diz se ela pode ir à API. Vale por processo do site, como os outros
 * freios (reiniciar zera). `limite` só é passado nos testes.
 */
export function buscaLiberada(ip: string | undefined, agoraMs: number, limite: Limite = buscas): boolean {
  const chave = ip ?? 'sem-ip';
  if (limite.bloqueado(chave, agoraMs)) return false;
  limite.registrarFalha(chave, agoraMs);
  return true;
}
