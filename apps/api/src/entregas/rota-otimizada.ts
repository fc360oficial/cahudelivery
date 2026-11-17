/**
 * Ordem das paradas de uma carga: sai do CD, passa por todos os clientes e volta ao CD pelo caminho mais curto
 * que dá para achar sem serviço de fora.
 *  1. começa pelo cliente mais perto do CD e vai sempre para o mais perto de onde está (vizinho mais próximo);
 *  2. depois testa inverter trechos da volta e fica com o que encurta (2-opt), até não melhorar mais.
 * Distância em linha reta × FATOR_RUAS (as ruas não são retas). Notas do mesmo cliente no mesmo ponto ficam juntas.
 * Entrega sem ponto no mapa vai para o fim, na ordem em que estava.
 */
export type LatLng = [number, number];

export interface ParadaRota {
  id: string;
  ponto: LatLng | null;
}

/** Ruas não são retas: em Recife/Jaboatão a distância de carro fica ~35% acima da linha reta. */
export const FATOR_RUAS = 1.35;
/** Velocidade média de caminhão na cidade, com trânsito. */
export const VELOCIDADE_KMH = 22;
/** Tempo médio descarregando em cada cliente. */
export const MIN_POR_PARADA = 15;

export function kmEntre(a: LatLng, b: LatLng): number {
  const r = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const chavePonto = (p: LatLng) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

interface No { ponto: LatLng; ids: string[] }

/** Junta as entregas que caem no mesmo ponto (mesmo cliente com várias notas) num nó só. */
function nos(paradas: ParadaRota[]): { nos: No[]; semPonto: string[] } {
  const porChave = new Map<string, No>();
  const semPonto: string[] = [];
  for (const p of paradas) {
    if (!p.ponto || !Number.isFinite(p.ponto[0]) || !Number.isFinite(p.ponto[1])) { semPonto.push(p.id); continue; }
    const k = chavePonto(p.ponto);
    const no = porChave.get(k);
    if (no) no.ids.push(p.id);
    else porChave.set(k, { ponto: p.ponto, ids: [p.id] });
  }
  return { nos: [...porChave.values()], semPonto };
}

/** Comprimento do caminho (linha reta), com CD no começo e no fim quando houver. */
function comprimento(cd: LatLng | null, ordem: No[]): number {
  const pts = [...(cd ? [cd] : []), ...ordem.map((n) => n.ponto), ...(cd ? [cd] : [])];
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += kmEntre(pts[i - 1], pts[i]);
  return s;
}

export function otimizarOrdem(cd: LatLng | null, paradas: ParadaRota[]): string[] {
  const { nos: lista, semPonto } = nos(paradas);
  if (lista.length <= 1) return [...lista.flatMap((n) => n.ids), ...semPonto];

  // 1. Vizinho mais próximo, saindo do CD (ou do primeiro cliente, se o CD não estiver cadastrado).
  const restantes = [...lista];
  const rota: No[] = [];
  let atual: LatLng = cd ?? restantes[0].ponto;
  while (restantes.length) {
    let melhor = 0;
    for (let i = 1; i < restantes.length; i++) if (kmEntre(atual, restantes[i].ponto) < kmEntre(atual, restantes[melhor].ponto)) melhor = i;
    const [no] = restantes.splice(melhor, 1);
    rota.push(no);
    atual = no.ponto;
  }

  // 2. 2-opt: inverte o trecho i..k quando isso encurta. Com CD as duas pontas são fixas (sai e volta);
  // sem CD o caminho é aberto e o fim fica livre.
  const pts: Array<LatLng | null> = [cd, ...rota.map((n) => n.ponto), cd];
  const d = (a: LatLng | null, b: LatLng | null) => (a && b ? kmEntre(a, b) : 0);
  let melhorou = true;
  for (let volta = 0; melhorou && volta < 200; volta++) {
    melhorou = false;
    for (let i = 1; i < pts.length - 2; i++) {
      for (let k = i + 1; k < pts.length - 1; k++) {
        const antes = d(pts[i - 1], pts[i]) + d(pts[k], pts[k + 1]);
        const depois = d(pts[i - 1], pts[k]) + d(pts[i], pts[k + 1]);
        if (depois < antes - 1e-9) {
          pts.splice(i, k - i + 1, ...pts.slice(i, k + 1).reverse());
          rota.splice(i - 1, k - i + 1, ...rota.slice(i - 1, k).reverse());
          melhorou = true;
        }
      }
    }
  }
  return [...rota.flatMap((n) => n.ids), ...semPonto];
}

export interface MedidaRota {
  /** Km estimados pelas ruas (com a volta ao CD quando ele está cadastrado); null sem pontos no mapa. */
  km: number | null;
  /** Tempo estimado de rua: dirigindo + MIN_POR_PARADA em cada cliente. */
  minutos: number | null;
  /** Entregas sem ponto no mapa (não entram na conta de km). */
  semPonto: number;
  /** A conta inclui ida e volta ao CD. */
  comCd: boolean;
}

/** Mede a rota na ordem em que está (serve para a ordem feita à mão também). */
export function medirRota(cd: LatLng | null, paradas: ParadaRota[]): MedidaRota {
  const semPonto = paradas.filter((p) => !p.ponto).length;
  // Mesma ordem, juntando as notas seguidas do mesmo ponto (é uma parada só).
  const ordem: No[] = [];
  for (const p of paradas) {
    if (!p.ponto) continue;
    const ultimo = ordem[ordem.length - 1];
    if (ultimo && chavePonto(ultimo.ponto) === chavePonto(p.ponto)) ultimo.ids.push(p.id);
    else ordem.push({ ponto: p.ponto, ids: [p.id] });
  }
  if (!ordem.length) return { km: null, minutos: null, semPonto, comCd: !!cd };
  const km = comprimento(cd, ordem) * FATOR_RUAS;
  const paradasReais = ordem.length + semPonto;
  return {
    km: Math.round(km * 10) / 10,
    minutos: Math.round((km / VELOCIDADE_KMH) * 60 + paradasReais * MIN_POR_PARADA),
    semPonto,
    comCd: !!cd,
  };
}
