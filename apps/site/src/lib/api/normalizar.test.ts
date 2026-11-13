import { describe, expect, it } from 'vitest';
import { normalizarCarrinho, normalizarConfig, normalizarHome, normalizarProduto } from './normalizar';

const BRUTO = {
  id: 'p1', sku: '123', ean: null, nome: 'Detergente', descricao: null, unidade_venda: 'CX',
  qtd_por_embalagem: 24, qtd_minima: 1, desconto_qtd_minima: 4, desconto_qtd_preco: '49.90',
  data_validade: '2026-12-05T03:00:00.000Z', marca: 'Ypê', marca_id: 'm1', categoria: 'Limpeza',
  categoria_id: 'c1', estoque: '12.000', preco_tabela: '52.80', preco_promocional: null, preco: '52.80',
  imagens: [{ url: 'http://x/a.jpg', miniatura: 'http://x/a_m.jpg', ordem: 0 }],
};

describe('normalizarProduto', () => {
  it('converte numeric em número e renomeia para camelCase', () => {
    const p = normalizarProduto(BRUTO);
    expect(p.preco).toBe(52.8);
    expect(p.precoTabela).toBe(52.8);
    expect(p.precoPromocional).toBeNull();
    expect(p.estoque).toBe(12);
    expect(p.descontoQtdPreco).toBe(49.9);
    expect(p.unidadeVenda).toBe('CX');
    expect(p.marcaId).toBe('m1');
    expect(p.imagens).toEqual([{ url: 'http://x/a.jpg', miniatura: 'http://x/a_m.jpg' }]);
  });

  it('aguenta produto enxuto de vitrine patrocinada', () => {
    const p = normalizarProduto({ id: 'p2', nome: 'X', unidade_venda: 'UN', qtd_por_embalagem: 1, preco: null, imagens: null });
    expect(p.preco).toBeNull();
    expect(p.imagens).toEqual([]);
    expect(p.qtdMinima).toBe(1);
    expect(p.estoque).toBe(0);
    expect(p.categoria).toBeNull();
  });
});

describe('normalizarHome', () => {
  it('normaliza produtos dentro de prateleiras e patrocinadores', () => {
    const h = normalizarHome({
      banners: [{ id: 'b1', titulo: 'T', imagem_url: 'http://x/b.jpg', destino_tipo: 'produto', destino_id: 'p1' }],
      promocoes: [BRUTO], maisVendidos: [], vencimentoProximo: [],
      prateleiras: [
        { tipo: 'categoria', categoriaId: 'c1', nome: 'Limpeza', produtos: [BRUTO] },
        { tipo: 'patrocinador', id: 's1', nome: 'Marca', logoUrl: null, bannerUrl: 'http://x/s.jpg', produtos: [BRUTO] },
      ],
      patrocinadoresTopo: [], patrocinadoresOfertas: [],
    });
    expect(h.banners[0]).toEqual({ id: 'b1', titulo: 'T', imagemUrl: 'http://x/b.jpg', destinoTipo: 'produto', destinoId: 'p1' });
    expect(h.promocoes[0].preco).toBe(52.8);
    expect(h.prateleiras[0].produtos[0].preco).toBe(52.8);
    expect(h.prateleiras[1].tipo).toBe('patrocinador');
  });

  it('campos ausentes viram listas vazias', () => {
    const h = normalizarHome({});
    expect(h.banners).toEqual([]);
    expect(h.prateleiras).toEqual([]);
    expect(h.patrocinadoresTopo).toEqual([]);
  });
});

describe('normalizarConfig', () => {
  it('cartão online, cartão "em breve" e condições do boleto como o app lê', () => {
    const c = (configuracoes: Record<string, unknown>) => normalizarConfig({ appNome: 'A', distribuidora: 'B', configuracoes });
    expect(c({ cartao_online: true }).cartaoOnline).toBe(true);
    expect(c({ cartao_online: 'true' }).cartaoOnline).toBe(false);
    // "Em breve" só com o aviso ligado E o cartão fora das formas aceitas (cartao_em_breve.dart).
    expect(c({ cartao_em_breve: true, formas_pagamento: ['pix'] }).cartaoEmBreve).toBe(true);
    expect(c({ cartao_em_breve: true, formas_pagamento: ['pix', 'cartao'] }).cartaoEmBreve).toBe(false);
    expect(c({ cartao_em_breve: true }).cartaoEmBreve).toBe(false);
    expect(c({ condicoes_boleto: ['À vista', '30 dias', '', 3, ' 30/60 dias '] }).condicoesBoleto).toEqual(['À vista', '30 dias', '30/60 dias']);
    expect(c({ condicoes_boleto: [] }).condicoesBoleto).toEqual(['À vista']);
    expect(c({}).condicoesBoleto).toEqual(['À vista']);
  });

  it('lê tema e configurações com valores padrão seguros', () => {
    const c = normalizarConfig({
      appNome: 'CAHU Delivery', distribuidora: 'CAHU',
      tema: { cor_primaria: '#FFD500', logo_url: 'http://x/l.png' },
      configuracoes: {
        limite_estoque_baixo: '5', contato_whatsapp: '(81) 99999-0000',
        pedido_minimo: { tipo: 'valor', valor: '100' }, horario_atendimento: { seg_sex: '08:00-19:00', sab: '08:00-13:00' },
        formas_pagamento: ['pix', 'cartao', '', 7],
        politica_privacidade: 'LOJA EXEMPLO LTDA — CNPJ 12.345.678/0001-90 ("nós")\n\nTexto da política.',
        politica_cancelamento: 'Texto do cancelamento.',
        indicacoes_ativas: true,
      },
    });
    expect(c).toEqual({
      appNome: 'CAHU Delivery', distribuidora: 'CAHU', corPrimaria: '#FFD500',
      logoUrl: 'http://x/l.png', limiteEstoqueBaixo: 5, contatoWhatsapp: '(81) 99999-0000',
      pedidoMinimo: 100, horarioSemana: '08:00-19:00', horarioSabado: '08:00-13:00',
      formasPagamento: ['pix', 'cartao'],
      cartaoOnline: false, cartaoEmBreve: false, condicoesBoleto: ['À vista'],
      politicaPrivacidade: 'LOJA EXEMPLO LTDA — CNPJ 12.345.678/0001-90 ("nós")\n\nTexto da política.',
      politicaCancelamento: 'Texto do cancelamento.',
      identificacaoLegal: 'LOJA EXEMPLO LTDA — CNPJ 12.345.678/0001-90',
      indicacoesAtivas: true,
    });
    const vazio = normalizarConfig({ appNome: 'A', distribuidora: 'B', tema: null, configuracoes: {} });
    expect(vazio.corPrimaria).toBeNull();
    expect(vazio.limiteEstoqueBaixo).toBe(0);
    expect(vazio.pedidoMinimo).toBeNull();
    expect(vazio.horarioSemana).toBeNull();
    expect(vazio.formasPagamento).toEqual([]);
    expect(vazio.identificacaoLegal).toBeNull();
    // Código de indicação no cadastro só com a chave ligada (como o app).
    expect(vazio.indicacoesAtivas).toBe(false);
    expect(normalizarConfig({ appNome: 'A', distribuidora: 'B', configuracoes: { indicacoes_ativas: 'true' } }).indicacoesAtivas).toBe(false);
    // Primeira linha sem CNPJ no formato não vira identificação legal.
    expect(normalizarConfig({ appNome: 'A', distribuidora: 'B', configuracoes: { politica_privacidade: 'Bem-vindo à nossa política' } }).identificacaoLegal).toBeNull();
    expect(vazio.contatoWhatsapp).toBeNull();
  });
});

describe('normalizarCarrinho', () => {
  it('converte quantidade e preço', () => {
    const c = normalizarCarrinho({
      itens: [{ produto_id: 'p1', quantidade: '2', nome: 'Detergente', unidade_venda: 'CX', qtd_minima: 1, estoque: '12', imagem_url: null, preco_atual: '52.80' }],
      subtotal: 105.6,
    });
    expect(c.itens[0]).toEqual({
      produtoId: 'p1', nome: 'Detergente', quantidade: 2, unidadeVenda: 'CX', qtdMinima: 1, estoque: 12, imagemUrl: null, precoAtual: 52.8,
    });
    expect(c.subtotal).toBe(105.6);
  });
});
