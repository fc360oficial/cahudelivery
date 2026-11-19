import { describe, expect, it } from 'vitest';
import type { Produto } from '@/lib/api/tipos';
import { casa, chaveDeBusca, itemDeBusca, normalizarBusca, sugerir, tokensDe } from './sugestoes';

let n = 0;
const produto = (nome: string, extra: Partial<Produto> = {}): Produto => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, sku: null, ean: null, nome, descricao: null,
  unidadeVenda: 'CX', qtdPorEmbalagem: 12, qtdMinima: 1, descontoQtdMinima: null, descontoQtdPreco: null, dataValidade: null,
  marca: null, marcaId: null, categoria: 'Mercearia', categoriaId: 'c1', estoque: 10, precoTabela: 10, precoPromocional: null,
  preco: 10, imagens: [], ...extra,
});
const itens = [
  produto('BISC CAPRICCHE MAMMAMIA 301,5G INTEGRAL CX20'),
  produto('BISC MARILAN COCO 300G CX/24'),
  produto('BISC MARILAN SALG SORT QUEIJO 300G CX/18'),
  produto('BISC PACK TORTUGUITA 43G MORANGO CX12', { categoria: 'Variedades' }),
  produto('CAFE ALMOFADA SANTA CLARA 250G EXTRA FD20', { ean: '7896224803107', sku: '1234' }),
  produto('CAFÉ SOLÚVEL SANTA CLARA CX24'),
  produto('PAPEL HIG MILI FD NEUTRO C4 30M FD24', { categoria: 'Higiene e Beleza', estoque: 0 }),
  produto('MOLHO BARBECUE', { preco: null, precoTabela: null }),
].map(itemDeBusca);

describe('texto da busca', () => {
  it('normaliza acento, caixa e pontuação', () => {
    expect(normalizarBusca('  Café  250G/CX-12 ')).toBe('cafe 250g cx 12');
    expect(chaveDeBusca({ nome: 'Açúcar', marca: 'Petribu', sku: '77', ean: '789' })).toBe('acucar petribu 77 789');
  });
  it('menos de 2 caracteres não busca; no máximo 6 palavras', () => {
    expect(tokensDe('a')).toEqual([]);
    expect(tokensDe(' a b ')).toEqual(['a', 'b']);
    expect(tokensDe('um dois tres quatro cinco seis sete')).toHaveLength(6);
  });
  it('casa todas as palavras, em qualquer ordem e pela metade', () => {
    const chave = chaveDeBusca({ nome: 'CAFE ALMOFADA SANTA CLARA 250G' });
    expect(casa(chave, tokensDe('clara cafe'))).toBe(true);
    expect(casa(chave, tokensDe('caf almo'))).toBe(true);
    expect(casa(chave, tokensDe('cafe pilao'))).toBe(false);
    expect(casa(chave, [])).toBe(false);
  });
});

describe('sugerir', () => {
  it('lista quem casa, com quem começa pela palavra na frente, e conta por categoria', () => {
    const r = sugerir(itens, 'bisc');
    expect(r.total).toBe(4);
    expect(r.produtos.map((p) => p.nome.split(' ').slice(0, 2).join(' '))).toEqual(['BISC CAPRICCHE', 'BISC MARILAN', 'BISC MARILAN', 'BISC PACK']);
    expect(r.categorias).toEqual([{ nome: 'Mercearia', n: 3 }, { nome: 'Variedades', n: 1 }]);
  });
  it('atalhos de refino: palavra digitada + a seguinte, do mais comum para o menos', () => {
    expect(sugerir(itens, 'bisc').refinos).toEqual([{ texto: 'bisc marilan', n: 2 }, { texto: 'bisc capricche', n: 1 }, { texto: 'bisc pack', n: 1 }]);
    expect(sugerir(itens, 'bisc marilan').refinos).toEqual([]);   // com duas palavras já está refinado
  });
  it('acha sem acento, por parte da palavra e pelo código de barras', () => {
    expect(sugerir(itens, 'cafe').total).toBe(2);
    expect(sugerir(itens, 'solu').produtos[0].nome).toBe('CAFÉ SOLÚVEL SANTA CLARA CX24');
    expect(sugerir(itens, '7896224803107').produtos[0].nome).toContain('ALMOFADA');
  });
  it('limite e filtro de categoria valem só para a lista; a contagem por categoria continua inteira', () => {
    const r = sugerir(itens, 'bisc', { limite: 2, categoria: 'Mercearia' });
    expect(r.total).toBe(3);
    expect(r.produtos).toHaveLength(2);
    expect(r.categorias).toHaveLength(2);
  });
  it('nada digitado ou nada encontrado devolve vazio', () => {
    expect(sugerir(itens, ' ')).toEqual({ total: 0, produtos: [], refinos: [], categorias: [] });
    expect(sugerir(itens, 'xyz').total).toBe(0);
  });
  it('sem estoque ou sem preço aparece, mas não pode ser comprado pela busca', () => {
    expect(sugerir(itens, 'papel').produtos[0].comprar).toBe(false);
    expect(sugerir(itens, 'molho').produtos[0].comprar).toBe(false);
    expect(sugerir(itens, 'cafe almofada').produtos[0].comprar).toBe(true);
  });
  it('preço riscado só quando a oferta baixa o preço', () => {
    const oferta = itemDeBusca(produto('SABAO', { precoTabela: 20, precoPromocional: 15, preco: 15 }));
    const igual = itemDeBusca(produto('SABAO B', { precoTabela: 20, precoPromocional: 20, preco: 20 }));
    expect(oferta.precoDe).toBe(20);
    expect(igual.precoDe).toBeNull();
  });
});
