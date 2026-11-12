import type { Produto } from '@/lib/api/tipos';
import { formatarValidade } from '@/lib/formato/datas';
import { formatarPreco, percentualDesconto } from '@/lib/formato/preco';

export interface Selo { tipo: 'oferta' | 'estoque' | 'validade' | 'quantidade'; texto: string }

export function selosDoProduto(p: Produto, limiteEstoqueBaixo: number): Selo[] {
  const selos: Selo[] = [];
  if (p.precoPromocional != null) {
    const pct = percentualDesconto(p.precoTabela, p.preco);
    selos.push({ tipo: 'oferta', texto: pct != null ? `-${pct}%` : 'Oferta' });
  }
  if (limiteEstoqueBaixo > 0 && p.estoque > 0 && p.estoque <= limiteEstoqueBaixo) {
    selos.push({ tipo: 'estoque', texto: `${Math.floor(p.estoque)} em estoque` });
  }
  if (p.dataValidade) selos.push({ tipo: 'validade', texto: `Val. ${formatarValidade(p.dataValidade)}` });
  if (p.descontoQtdMinima != null && p.descontoQtdPreco != null) {
    selos.push({ tipo: 'quantidade', texto: `${p.descontoQtdMinima} ou mais: ${formatarPreco(p.descontoQtdPreco)}` });
  }
  return selos;
}
