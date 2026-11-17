/**
 * Sugestão de cargas: distribui as entregas pendentes nos caminhões livres.
 *
 * Regra (o gerente do CD autoriza, tira ou troca depois; nada sai sem autorização):
 *  1. as entregas são agrupadas por cidade; dentro da cidade, por bairro e cliente (notas do mesmo cliente
 *     ficam juntas, viram uma parada só);
 *  2. as cidades com mais peso escolhem caminhão primeiro; o caminhão cuja "região de costume" bate com a
 *     cidade ou com um bairro dela tem preferência, e caminhão de outra região fica guardado para ela;
 *  3. o peso estimado da carga respeita o que o caminhão leva; o que passa vai para outro caminhão;
 *  4. acabaram os caminhões: o que sobrou é encaixado onde ainda couber; o que não couber fica fora das
 *     cargas, com o motivo.
 * A posição do cliente hoje vem do CEP (bairro, não a porta), então a ordem das paradas é por bairro;
 * a ordem rua a rua fica para depois.
 */

export interface EntregaParaCarga {
  id: string;
  cidade: string | null;
  bairro: string | null;
  cliente: string;
  /** null = nenhum item com peso conhecido (conta como zero na lotação). */
  pesoKg: number | null;
}

export interface CaminhaoParaCarga {
  id: string;
  /** null = não informado: não limita. */
  capacidadeKg: number | null;
  regiao: string | null;
}

export type MotivoFora = 'sem_caminhao' | 'nao_cabe';

export interface SugestaoDeCargas {
  cargas: Array<{ caminhaoId: string; entregaIds: string[]; pesoKg: number }>;
  fora: Array<{ id: string; motivo: MotivoFora }>;
}

export const chave = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

const peso = (e: EntregaParaCarga) => (e.pesoKg !== null && e.pesoKg > 0 ? e.pesoKg : 0);
const arredondar = (kg: number) => Math.round(kg * 10) / 10;

interface Grupo { cidade: string; bairros: Set<string>; entregas: EntregaParaCarga[]; pesoKg: number }

function combina(regiao: string | null, grupo: Grupo): boolean {
  const r = chave(regiao);
  if (!r) return false;
  if (grupo.cidade && (grupo.cidade.includes(r) || r.includes(grupo.cidade))) return true;
  for (const b of grupo.bairros) if (b && (b.includes(r) || r.includes(b))) return true;
  return false;
}

export function sugerirCargas(entregas: EntregaParaCarga[], caminhoes: CaminhaoParaCarga[]): SugestaoDeCargas {
  const porCidade = new Map<string, Grupo>();
  for (const e of entregas) {
    const cidade = chave(e.cidade);
    const g = porCidade.get(cidade) ?? { cidade, bairros: new Set<string>(), entregas: [], pesoKg: 0 };
    g.entregas.push(e);
    g.bairros.add(chave(e.bairro));
    g.pesoKg += peso(e);
    porCidade.set(cidade, g);
  }
  const fila = [...porCidade.values()];
  for (const g of fila) {
    g.entregas.sort((a, b) => chave(a.bairro).localeCompare(chave(b.bairro)) || chave(a.cliente).localeCompare(chave(b.cliente)) || a.id.localeCompare(b.id));
  }
  fila.sort((a, b) => b.pesoKg - a.pesoKg || b.entregas.length - a.entregas.length || a.cidade.localeCompare(b.cidade));

  const livres = [...caminhoes];
  const cargas: Array<{ caminhao: CaminhaoParaCarga; entregaIds: string[]; pesoKg: number }> = [];
  const semCaminhao: EntregaParaCarga[] = [];
  const fora: SugestaoDeCargas['fora'] = [];
  // Sem caminhão nenhum o motivo é "sem caminhão", não "não cabe".
  const maiorCapacidade = !caminhoes.length || caminhoes.some((c) => c.capacidadeKg === null)
    ? Infinity
    : Math.max(...caminhoes.map((c) => c.capacidadeKg ?? 0));

  while (fila.length) {
    const grupo = fila.shift()!;
    if (!livres.length) {
      semCaminhao.push(...grupo.entregas);
      continue;
    }
    // 1º o caminhão da região; 2º um que não seja "de costume" de outra cidade ainda na fila; 3º o primeiro livre.
    let i = livres.findIndex((c) => combina(c.regiao, grupo));
    if (i < 0) i = livres.findIndex((c) => !fila.some((outro) => combina(c.regiao, outro)));
    if (i < 0) i = 0;
    const [caminhao] = livres.splice(i, 1);
    const limite = caminhao.capacidadeKg ?? Infinity;

    const carga = { caminhao, entregaIds: [] as string[], pesoKg: 0 };
    const sobra: EntregaParaCarga[] = [];
    for (const e of grupo.entregas) {
      if (peso(e) > maiorCapacidade) {
        fora.push({ id: e.id, motivo: 'nao_cabe' });
      } else if (carga.pesoKg + peso(e) <= limite) {
        carga.entregaIds.push(e.id);
        carga.pesoKg += peso(e);
      } else {
        sobra.push(e);
      }
    }
    if (carga.entregaIds.length) cargas.push(carga);
    else livres.splice(i, 0, caminhao); // nada coube neste: devolve para a fila de livres
    if (sobra.length) {
      // O que passou do peso continua sendo da mesma cidade e disputa o próximo caminhão na frente das outras.
      const resto: Grupo = { cidade: grupo.cidade, bairros: new Set(sobra.map((e) => chave(e.bairro))), entregas: sobra, pesoKg: sobra.reduce((s, e) => s + peso(e), 0) };
      if (carga.entregaIds.length) fila.unshift(resto);
      else semCaminhao.push(...sobra); // nem o caminhão vazio levou: não insiste (evita laço)
    }
  }

  // Encaixe: o que ficou sem caminhão entra na carga com mais folga, se couber.
  for (const e of semCaminhao) {
    if (peso(e) > maiorCapacidade) {
      fora.push({ id: e.id, motivo: 'nao_cabe' });
      continue;
    }
    let melhor: (typeof cargas)[number] | null = null;
    let melhorFolga = -1;
    for (const c of cargas) {
      const folga = (c.caminhao.capacidadeKg ?? Infinity) - c.pesoKg;
      if (folga >= peso(e) && folga > melhorFolga) {
        melhor = c;
        melhorFolga = folga;
      }
    }
    if (melhor) {
      melhor.entregaIds.push(e.id);
      melhor.pesoKg += peso(e);
    } else {
      fora.push({ id: e.id, motivo: 'sem_caminhao' });
    }
  }

  return {
    cargas: cargas.map((c) => ({ caminhaoId: c.caminhao.id, entregaIds: c.entregaIds, pesoKg: arredondar(c.pesoKg) })),
    fora,
  };
}
