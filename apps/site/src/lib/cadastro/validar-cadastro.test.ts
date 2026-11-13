import { describe, expect, it } from 'vitest';
import { CATEGORIAS, caiuNaArmadilha, senhaFraca, validarCadastro } from './validar-cadastro';

const CNPJ = '11222333000181';
const CPF = '52998224725';

const enderecoValido = () => ({
  cep: '51210-050', logradouro: ' Rua Teste ', numero: '10', complemento: '', bairro: 'Boa Viagem',
  cidade: 'Recife', uf: 'pe', codigoMunicipio: '2611606',
});

const cnpjValido = (extra: Record<string, unknown> = {}) => ({
  tipo: 'CNPJ', documento: '11.222.333/0001-81', nomeFantasia: ' Mercadinho Bom Preço ', razaoSocial: 'Bom Preço Ltda',
  inscricaoEstadual: '0321.418-40', isentoIe: false, email: ' Compras@Exemplo.com.br ', telefone: '(81) 99999-0000',
  endereco: enderecoValido(), categoria: 'Restaurante', senha: ' senha boa 1 ', codigoIndicacao: ' ab2cd3 ',
  ...extra,
});

function erros(corpo: unknown) {
  const r = validarCadastro(corpo);
  if (r.ok) throw new Error('esperava erro');
  return r.erros;
}

function dados(corpo: unknown) {
  const r = validarCadastro(corpo);
  if (!r.ok) throw new Error(`esperava válido: ${JSON.stringify(r.erros)}`);
  return r.dados;
}

describe('validarCadastro: corpo válido', () => {
  it('CNPJ: só os campos do RegistrarDto, documento/telefone/CEP/IE em dígitos, textos aparados', () => {
    expect(dados(cnpjValido({ status: 'aprovado', clienteId: 'x' }))).toEqual({
      tipo: 'CNPJ',
      documento: CNPJ,
      nomeFantasia: 'Mercadinho Bom Preço',
      razaoSocial: 'Bom Preço Ltda',
      email: 'Compras@Exemplo.com.br',
      telefone: '81999990000',
      endereco: {
        cep: '51210050', logradouro: 'Rua Teste', numero: '10', bairro: 'Boa Viagem', cidade: 'Recife', uf: 'PE',
        codigoMunicipio: '2611606',
      },
      categoria: 'Restaurante',
      inscricaoEstadual: '032141840',
      senha: ' senha boa 1 ',
      codigoIndicacao: 'AB2CD3',
    });
  });

  it('CNPJ isento: manda isentoIe e não manda inscrição', () => {
    const d = dados(cnpjValido({ isentoIe: true, inscricaoEstadual: '' }));
    expect(d.isentoIe).toBe(true);
    expect(d).not.toHaveProperty('inscricaoEstadual');
  });

  it('isento marcado vence a inscrição digitada (como o app, que limpa o campo)', () => {
    const d = dados(cnpjValido({ isentoIe: true, inscricaoEstadual: '12345678' }));
    expect(d.isentoIe).toBe(true);
    expect(d).not.toHaveProperty('inscricaoEstadual');
  });

  it('CPF: sem razão social, inscrição nem isento', () => {
    const d = dados(cnpjValido({ tipo: 'CPF', documento: '529.982.247-25', isentoIe: true }));
    expect(d.tipo).toBe('CPF');
    expect(d.documento).toBe(CPF);
    expect(d).not.toHaveProperty('razaoSocial');
    expect(d).not.toHaveProperty('inscricaoEstadual');
    expect(d).not.toHaveProperty('isentoIe');
  });

  it('opcionais vazios ou ausentes ficam de fora', () => {
    const d = dados(cnpjValido({ razaoSocial: '  ', email: '', categoria: '', codigoIndicacao: undefined, endereco: { ...enderecoValido(), codigoMunicipio: undefined } }));
    for (const campo of ['razaoSocial', 'email', 'categoria', 'codigoIndicacao']) expect(d).not.toHaveProperty(campo);
    expect(d.endereco).not.toHaveProperty('codigoMunicipio');
    expect(d.endereco).not.toHaveProperty('complemento');
  });

  it('complemento preenchido vai aparado', () => {
    expect(dados(cnpjValido({ endereco: { ...enderecoValido(), complemento: ' Loja 2 ' } })).endereco.complemento).toBe('Loja 2');
  });

  it('código do município fora do formato IBGE (7 dígitos) é descartado, não bloqueia', () => {
    expect(dados(cnpjValido({ endereco: { ...enderecoValido(), codigoMunicipio: '26116' } })).endereco).not.toHaveProperty('codigoMunicipio');
    expect(dados(cnpjValido({ endereco: { ...enderecoValido(), codigoMunicipio: 2611606 } })).endereco).not.toHaveProperty('codigoMunicipio');
  });

  it('telefone fixo com 10 dígitos vale', () => {
    expect(dados(cnpjValido({ telefone: '(81) 3333-4444' })).telefone).toBe('8133334444');
  });

  it('as categorias são as do app', () => {
    expect(CATEGORIAS).toEqual([
      'Açougue e Frigorífico', 'Atacarejo e Supermercado', 'Restaurante', 'Bar e Petiscos', 'Padaria e Confeitaria',
      'Cafeteria', 'Mercearia e Conveniência', 'Distribuidor', 'Outro',
    ]);
  });
});

describe('validarCadastro: erros por campo', () => {
  it('corpo que não é objeto', () => {
    expect(validarCadastro(null).ok).toBe(false);
    expect(validarCadastro([]).ok).toBe(false);
    expect(validarCadastro('x').ok).toBe(false);
  });

  it('tipo fora de CNPJ/CPF', () => {
    expect(erros(cnpjValido({ tipo: 'RG' })).tipo).toBe('Escolha CNPJ ou CPF');
  });

  it('documento com dígito verificador errado ou do tipo errado', () => {
    expect(erros(cnpjValido({ documento: '11222333000182' })).documento).toBe('CNPJ inválido');
    expect(erros(cnpjValido({ documento: CPF })).documento).toBe('CNPJ inválido');
    expect(erros(cnpjValido({ tipo: 'CPF', documento: '52998224724' })).documento).toBe('CPF inválido');
    expect(erros(cnpjValido({ documento: 11222333000181 })).documento).toBe('CNPJ inválido');
  });

  it('obrigatórios vazios', () => {
    const e = erros(cnpjValido({
      nomeFantasia: ' ', telefone: '', endereco: { cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '' }, senha: '',
    }));
    expect(e).toMatchObject({
      nomeFantasia: 'Campo obrigatório', telefone: 'Informe o telefone com DDD', cep: 'CEP inválido',
      logradouro: 'Campo obrigatório', numero: 'Campo obrigatório', bairro: 'Campo obrigatório', cidade: 'Campo obrigatório',
      uf: 'UF inválida', senha: 'Mínimo de 6 caracteres',
    });
  });

  it('endereço ausente ou de tipo errado marca os campos do endereço', () => {
    expect(erros(cnpjValido({ endereco: undefined }))).toMatchObject({ cep: 'CEP inválido', logradouro: 'Campo obrigatório' });
    expect(erros(cnpjValido({ endereco: 'Rua X' }))).toMatchObject({ cep: 'CEP inválido', uf: 'UF inválida' });
  });

  it('campo de tipo errado é recusado', () => {
    expect(erros(cnpjValido({ nomeFantasia: ['a'] })).nomeFantasia).toBe('Campo obrigatório');
    expect(erros(cnpjValido({ endereco: { ...enderecoValido(), numero: 10 } })).numero).toBe('Campo obrigatório');
    expect(erros(cnpjValido({ isentoIe: 'sim' })).inscricaoEstadual).toBe('Informe a IE ou marque Isento');
  });

  it('tamanhos máximos em todos os textos', () => {
    const longo = (n: number) => 'a'.repeat(n + 1);
    const e = erros(cnpjValido({
      nomeFantasia: longo(120), razaoSocial: longo(150), email: `${longo(250)}@x.com`, categoria: longo(60),
      endereco: { ...enderecoValido(), logradouro: longo(120), numero: longo(20), complemento: longo(80), bairro: longo(80), cidade: longo(80) },
      senha: longo(200), codigoIndicacao: longo(20).toUpperCase(),
    }));
    expect(e).toMatchObject({
      nomeFantasia: 'Use no máximo 120 caracteres', razaoSocial: 'Use no máximo 150 caracteres', email: 'E-mail inválido',
      logradouro: 'Use no máximo 120 caracteres', numero: 'Use no máximo 20 caracteres', complemento: 'Use no máximo 80 caracteres',
      bairro: 'Use no máximo 80 caracteres', cidade: 'Use no máximo 80 caracteres', categoria: 'Categoria inválida',
      senha: 'Use no máximo 200 caracteres', codigoIndicacao: 'Código de indicação inválido',
    });
    expect(erros(cnpjValido({ telefone: '9'.repeat(40) })).telefone).toBe('Informe o telefone com DDD');
    expect(erros(cnpjValido({ documento: '1'.repeat(41) })).documento).toBe('CNPJ inválido');
    expect(erros(cnpjValido({ inscricaoEstadual: '1'.repeat(31) })).inscricaoEstadual).toBe('Inscrição Estadual inválida');
  });

  it('inscrição estadual: regra do app e da API (8 a 14 dígitos ou Isento)', () => {
    expect(erros(cnpjValido({ inscricaoEstadual: '' })).inscricaoEstadual).toBe('Informe a IE ou marque Isento');
    expect(erros(cnpjValido({ inscricaoEstadual: undefined })).inscricaoEstadual).toBe('Informe a IE ou marque Isento');
    expect(erros(cnpjValido({ inscricaoEstadual: '1234567' })).inscricaoEstadual).toBe('Inscrição Estadual inválida');
    expect(erros(cnpjValido({ inscricaoEstadual: '123456789012345' })).inscricaoEstadual).toBe('Inscrição Estadual inválida');
    expect(dados(cnpjValido({ inscricaoEstadual: '12345678' })).inscricaoEstadual).toBe('12345678');
    expect(dados(cnpjValido({ inscricaoEstadual: '12345678901234' })).inscricaoEstadual).toBe('12345678901234');
  });

  it('e-mail, telefone, UF e categoria', () => {
    expect(erros(cnpjValido({ email: 'sem-arroba.com' })).email).toBe('E-mail inválido');
    expect(erros(cnpjValido({ email: 'a@b' })).email).toBe('E-mail inválido');
    expect(erros(cnpjValido({ telefone: '(81) 9999-000' })).telefone).toBe('Informe o telefone com DDD');
    expect(erros(cnpjValido({ telefone: '819999900001' })).telefone).toBe('Informe o telefone com DDD');
    expect(erros(cnpjValido({ endereco: { ...enderecoValido(), uf: 'XX' } })).uf).toBe('UF inválida');
    expect(erros(cnpjValido({ endereco: { ...enderecoValido(), cep: '5121005' } })).cep).toBe('CEP inválido');
    expect(erros(cnpjValido({ categoria: 'Farmácia' })).categoria).toBe('Categoria inválida');
  });

  it('senha: mínimo, máximo e a regra de senha fraca da API', () => {
    expect(erros(cnpjValido({ senha: '12345' })).senha).toBe('Mínimo de 6 caracteres');
    expect(erros(cnpjValido({ senha: '123456' })).senha).toBe('Essa senha é fácil de adivinhar. Escolha outra.');
    expect(erros(cnpjValido({ senha: CNPJ })).senha).toBe('Essa senha é fácil de adivinhar. Escolha outra.');
    expect(erros(cnpjValido({ senha: 7 })).senha).toBe('Mínimo de 6 caracteres');
  });

  it('código de indicação só com letras e números', () => {
    expect(erros(cnpjValido({ codigoIndicacao: 'AB-12' })).codigoIndicacao).toBe('Código de indicação inválido');
    expect(erros(cnpjValido({ codigoIndicacao: 12 })).codigoIndicacao).toBe('Código de indicação inválido');
  });
});

describe('senhaFraca (mesma regra da API)', () => {
  it('recusa as sequências da lista e o próprio documento', () => {
    for (const s of ['123456', '654321', '123123', '111111', '000000']) expect(senhaFraca(s, CNPJ)).toBe(true);
    expect(senhaFraca(CNPJ, CNPJ)).toBe(true);
    expect(senhaFraca('1234567', CNPJ)).toBe(false);
  });
});

describe('caiuNaArmadilha', () => {
  it('só quando o campo invisível veio preenchido', () => {
    expect(caiuNaArmadilha({ paginaWeb: 'http://spam' })).toBe(true);
    expect(caiuNaArmadilha({ paginaWeb: '' })).toBe(false);
    expect(caiuNaArmadilha({ paginaWeb: '   ' })).toBe(false);
    expect(caiuNaArmadilha({})).toBe(false);
    expect(caiuNaArmadilha(null)).toBe(false);
    expect(caiuNaArmadilha({ paginaWeb: 1 })).toBe(true);
  });
});
