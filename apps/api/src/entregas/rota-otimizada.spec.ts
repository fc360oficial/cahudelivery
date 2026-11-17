import { kmEntre, medirRota, otimizarOrdem, type LatLng, type ParadaRota } from './rota-otimizada';

const CD: LatLng = [-8.1335, -34.9045]; // Boa Viagem
const p = (id: string, lat: number, lng: number): ParadaRota => ({ id, ponto: [lat, lng] });

/** Força bruta: menor volta fechada saindo e voltando ao CD. */
function melhorPossivel(cd: LatLng, paradas: ParadaRota[]): number {
  const pts = paradas.map((x) => x.ponto!);
  let melhor = Infinity;
  const permutar = (resto: LatLng[], feito: LatLng[]) => {
    if (!resto.length) {
      const todos = [cd, ...feito, cd];
      let s = 0;
      for (let i = 1; i < todos.length; i++) s += kmEntre(todos[i - 1], todos[i]);
      melhor = Math.min(melhor, s);
      return;
    }
    resto.forEach((r, i) => permutar([...resto.slice(0, i), ...resto.slice(i + 1)], [...feito, r]));
  };
  permutar(pts, []);
  return melhor;
}

describe('otimizarOrdem', () => {
  it('sai do CD pelo cliente mais perto e faz a menor volta', () => {
    // Fora de ordem; em volta fechada, ir e voltar por caminhos diferentes pode empatar.
    const paradas = [p('longe', -8.23, -34.94), p('perto', -8.15, -34.91), p('meio', -8.19, -34.92), p('lado', -8.17, -34.96)];
    const ordem = otimizarOrdem(CD, paradas);
    expect(ordem[0]).toBe('perto');
    const ordenadas = ordem.map((id) => paradas.find((x) => x.id === id)!);
    // medirRota arredonda os km para uma casa: tolerância de 100 m.
    expect(medirRota(CD, ordenadas).km! / 1.35).toBeLessThanOrEqual(melhorPossivel(CD, paradas) + 0.1);
  });

  it('acha a menor volta (ou quase) comparando com todas as ordens possíveis', () => {
    const paradas = [
      p('a', -8.176, -34.919), p('b', -8.201, -34.922), p('c', -8.118, -34.942), p('d', -8.078, -34.909),
      p('e', -8.106, -34.972), p('f', -8.146, -34.983), p('g', -8.229, -34.943),
    ];
    const ordem = otimizarOrdem(CD, paradas);
    const ordenadas = ordem.map((id) => paradas.find((x) => x.id === id)!);
    const km = medirRota(CD, ordenadas).km! / 1.35;
    expect(km).toBeLessThanOrEqual(melhorPossivel(CD, paradas) * 1.03 + 0.05);
    expect(new Set(ordem)).toEqual(new Set(paradas.map((x) => x.id)));
  });

  it('mantém juntas as notas do mesmo cliente e manda para o fim quem não tem ponto', () => {
    const paradas = [p('n1', -8.2, -34.92), { id: 'sem', ponto: null }, p('n2', -8.15, -34.91), p('n1b', -8.2, -34.92)];
    const ordem = otimizarOrdem(CD, paradas);
    expect(ordem[ordem.length - 1]).toBe('sem');
    expect(Math.abs(ordem.indexOf('n1') - ordem.indexOf('n1b'))).toBe(1);
  });

  it('funciona sem CD cadastrado (caminho aberto) e com uma parada só', () => {
    expect(otimizarOrdem(null, [p('x', -8.1, -34.9), p('y', -8.2, -34.9), p('z', -8.15, -34.9)])).toEqual(['x', 'z', 'y']);
    expect(otimizarOrdem(CD, [p('so', -8.1, -34.9)])).toEqual(['so']);
    expect(otimizarOrdem(CD, [])).toEqual([]);
  });
});

describe('medirRota', () => {
  it('conta ida e volta ao CD, o fator das ruas e o tempo em cada cliente', () => {
    const m = medirRota(CD, [p('a', -8.1515, -34.9045)]); // ~2 km ao sul
    expect(m.comCd).toBe(true);
    expect(m.km).toBeCloseTo(2 * 2.0 * 1.35, 0);
    expect(m.minutos).toBeGreaterThanOrEqual(15);
  });

  it('sem nenhum ponto no mapa não inventa km', () => {
    expect(medirRota(CD, [{ id: 'x', ponto: null }])).toEqual({ km: null, minutos: null, semPonto: 1, comCd: true });
  });
});
