import { embalagemDoNome, gramaturaDoNome, pesoPorUnidadeDeVenda } from './peso-estimado';

describe('gramaturaDoNome', () => {
  it.each([
    ['ACHOC PO 3 CORACOES 200G SACHE CX12', 0.2],
    ['ACUCAR PETRIBU DEMERARA 1KG FD10', 1],
    ['AGUA SANITARIA DRAGAO 2L CX6', 2],
    ['AGUA SANITARIA DRAGAO 5L CX2', 5],
    ['ALA LAVA ROUPAS EM PO 400G ERVA DOCE', 0.4],
    ['BEM TE VI LAVA ROUPAS EM PO 1,6K FLORES', 1.6],
    ['OLEO DE SOJA 900ML', 0.9],
    ['REFRIGERANTE 1.5 L', 1.5],
    ['LEITE EM PO 800 GR', 0.8],
    ['ANTARCTICA PACK C2 GUARANA DE 1L', 1],
    ['SABONETE 5X85G', 0.425],
    ['DETERGENTE 500ml neutro', 0.5],
    ['RACAO PEDIGREE ADULTO CARNE E VEGETAIS SC20KG', 20],
    ['RACAO WHISKAS CARNE SC10,1KG', 10.1],
    ['CERVEJA LT350ML', 0.35],
  ])('%s → %s kg', (nome, kg) => {
    expect(gramaturaDoNome(nome)).toBeCloseTo(kg as number, 3);
  });

  it.each([
    'PAPEL HIG FLORAL NEUTRO C4 30M FD16', // 30M é metro
    'GUARDANAPO MALU 21X23CM F48', // medida, não peso
    'LAVA ROUPAS SONHO PO LV400 PG360 COCO FD26', // leve 400 pague 360: não adivinha
    'CAFE SOLUVEL SANTA CLARA RF L40P36 CLASS CX24',
    'ABS NOTURNO ALWAYS SECA LV48/PG40',
    'ENERGIZER PILHA AA2 MAX CT/02 ALC PQNA 4700',
    'APARELHO 100 LÂMINAS', // "100 L" seguido de letra acentuada
    'BATON GAROTO CASH 30UN CHOCOLATE AO LEIT',
    'FOSFORO GABOARDI FD20',
  ])('%s → o nome não diz o peso', (nome) => {
    expect(gramaturaDoNome(nome)).toBeNull();
  });
});

describe('embalagemDoNome', () => {
  it.each([
    ['ACHOC PO 3 CORACOES 200G SACHE CX12', 12],
    ['ACUCAR PETRIBU DEMERARA 1KG FD10', 10],
    ['ANTARCTICA PACK C2 GUARANA DE 1L', 2],
    ['ENERGIZER PILHA AA2 MAX CT/02 ALC', 2],
    ['BATON GAROTO CASH 30UN CHOCOLATE', 30],
    ['PAPEL HIG FLORAL NEUTRO C4 30M FD16', 16],
    ['ALA LAVA ROUPAS EM PO 400G ERVA DOCE', 1],
  ])('%s → %s', (nome, n) => {
    expect(embalagemDoNome(nome)).toBe(n);
  });
});

describe('pesoPorUnidadeDeVenda', () => {
  it('peso do cadastro vence o nome', () => {
    expect(pesoPorUnidadeDeVenda({ nome: 'ACUCAR 1KG FD10', pesoKg: 10.4, qtdPorEmbalagem: 10 })).toEqual({ kg: 10.4, origem: 'cadastro' });
  });

  it('gramatura × embalagem do cadastro', () => {
    expect(pesoPorUnidadeDeVenda({ nome: 'ACHOC PO 3 CORACOES 200G SACHE CX12', qtdPorEmbalagem: 12 })).toEqual({ kg: 2.4, origem: 'nome' });
    expect(pesoPorUnidadeDeVenda({ nome: 'ALA LAVA ROUPAS EM PO 400G ERVA DOCE', qtdPorEmbalagem: 27 })).toEqual({ kg: 10.8, origem: 'nome' });
    expect(pesoPorUnidadeDeVenda({ nome: 'AGUA SANITARIA DRAGAO 2L CX6', qtdPorEmbalagem: '6.000' as never })).toEqual({ kg: 12, origem: 'nome' });
  });

  it('cadastro diz 1 mas o nome diz mais: vale o maior', () => {
    expect(pesoPorUnidadeDeVenda({ nome: 'ANTARCTICA PACK C2 GUARANA DE 1L', qtdPorEmbalagem: 1 })).toEqual({ kg: 2, origem: 'nome' });
  });

  it('sem produto no cadastro, usa só o que o nome diz', () => {
    expect(pesoPorUnidadeDeVenda({ nome: 'ACUCAR PETRIBU DEMERARA 1KG FD10' })).toEqual({ kg: 10, origem: 'nome' });
    expect(pesoPorUnidadeDeVenda({ nome: 'BEM TE VI LAVA ROUPAS EM PO 4KG LAVANDA' })).toEqual({ kg: 4, origem: 'nome' });
  });

  it('vendido por quilo pesa a própria quantidade', () => {
    expect(pesoPorUnidadeDeVenda({ nome: 'QUEIJO COALHO', unidadeVenda: 'KG' })).toEqual({ kg: 1, origem: 'nome' });
  });

  it('nome sem gramatura fica sem peso; zero ou negativo no cadastro não vale', () => {
    expect(pesoPorUnidadeDeVenda({ nome: 'PAPEL HIG FLORAL NEUTRO C4 30M FD16', qtdPorEmbalagem: 16 })).toEqual({ kg: null, origem: null });
    expect(pesoPorUnidadeDeVenda({ nome: 'FOSFORO GABOARDI FD20', pesoKg: 0 })).toEqual({ kg: null, origem: null });
  });
});
