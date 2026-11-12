const NOMES: Record<string, string> = { UN: 'Unidade', CX: 'Caixa', FD: 'Fardo', PC: 'Pacote', KG: 'Quilo' };

export function nomeEmbalagem(unidade: string): string {
  return NOMES[String(unidade ?? '').toUpperCase()] ?? 'Embalagem';
}

export function rotuloEmbalagem(unidade: string, qtd: number): string {
  const nome = nomeEmbalagem(unidade);
  return qtd > 1 ? `${nome} com ${qtd} unidades` : nome;
}
