import { runComTenant } from '../tenancy/tenant-context';
import { NotasAEntregarService } from './notas-a-entregar.service';

interface Cenario { pedidos?: unknown[]; notas?: unknown[]; produtos?: unknown[] }

function montar(c: Cenario) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from pedidos p')) return { rows: c.pedidos ?? [] };
    if (sql.includes('from notas_entrega ne')) return { rows: c.notas ?? [] };
    if (sql.includes('from produtos')) return { rows: c.produtos ?? [] };
    return { rows: [] };
  });
  return { query, pool: { query } };
}

const listar = (c: Cenario) => {
  const { query, pool } = montar(c);
  return runComTenant({ tenant: {}, pool } as never, () => new NotasAEntregarService().listar()).then((r) => ({ r, query }));
};

const ENDERECO = { id: 'e1', logradouro: 'Rua do Sol', numero: '120', complemento: null, bairro: 'Prazeres', cidade: 'Jaboatão dos Guararapes', uf: 'PE', cep: '54310-000' };
const ACUCAR = { id: 'p-acucar', sku: '789', erp_produto_id: '1001', nome: 'ACUCAR PETRIBU DEMERARA 1KG FD10', unidade_venda: 'CX', qtd_por_embalagem: '10.000', peso_kg: null };
const PAPEL = { id: 'p-papel', sku: '456', erp_produto_id: '1002', nome: 'PAPEL HIG FLORAL NEUTRO C4 30M FD16', unidade_venda: 'CX', qtd_por_embalagem: '16.000', peso_kg: null };
const PAPEL_PESADO = { ...PAPEL, peso_kg: '6.500' };

const pedido = (extra: Record<string, unknown> = {}) => ({
  id: 'ped-1', numero: '417', origem: 'app_cliente', total: '500.00', endereco: ENDERECO, cliente: 'Mercadinho Santa Luzia', telefone: '81999990000',
  numero_nf: '48211', serie: '3', emitida_em: '2026-11-17T11:10:00.000Z', total_faturado: null, itens_faturados: null,
  itens_pedido: [{ produtoId: 'p-acucar', descricao: 'ACUCAR', quantidade: 5 }, { produtoId: 'p-papel', descricao: 'PAPEL', quantidade: 2 }],
  latitude: -8.16, longitude: -34.92, ...extra,
});

const nota = (extra: Record<string, unknown> = {}) => ({
  id: 'ne-1', numero_nf: '48220', serie: '3', pedido_numero: '123456', origem: 'televendas', total: '1500.00', volumes: null, peso_bruto_kg: null,
  destinatario: { nome: 'SUPERMERCADO LITORAL LTDA', fone: '8133330000', endereco: { logradouro: 'Av. Bernardo Vieira de Melo', numero: '1820', bairro: 'Candeias', municipio: 'JABOATAO DOS GUARARAPES', uf: 'PE', cep: '54440620' } },
  itens: [{ codigo: '1001', descricao: 'ACUCAR PETRIBU DEMERARA 1KG FD10', quantidade: 20 }],
  emitida_em: '2026-11-17T12:00:00.000Z', cliente: 'Supermercado Litoral', telefone: null,
  cep_cadastro: '54440-620', complemento: 'Doca lateral', latitude: -8.2, longitude: -34.93, ...extra,
});

describe('NotasAEntregarService', () => {
  it('pedido do app: volumes pela soma das quantidades, peso só do que dá para saber e o item sem peso é contado', async () => {
    const { r } = await listar({ pedidos: [pedido()], produtos: [ACUCAR, PAPEL] });
    expect(r.entregas).toHaveLength(1);
    expect(r.entregas[0]).toMatchObject({
      id: 'pedido:ped-1', origem: 'app', pedidoNumero: '417', cliente: 'Mercadinho Santa Luzia',
      nota: { numero: '48211', serie: '3' }, total: 500, volumes: 7, pesoKg: 50, itensSemPeso: 1, itens: 2,
      endereco: { bairro: 'Prazeres', cidade: 'Jaboatão dos Guararapes', cep: '54310-000' }, latitude: -8.16, longitude: -34.92,
    });
    expect(r.resumo).toEqual({ entregas: 1, volumes: 7, pesoKg: 50, comPesoIncompleto: 1, semLocalizacao: 0 });
  });

  it('peso informado no cadastro do produto completa a conta', async () => {
    const { r } = await listar({ pedidos: [pedido()], produtos: [ACUCAR, PAPEL_PESADO] });
    expect(r.entregas[0]).toMatchObject({ pesoKg: 63, itensSemPeso: 0 });
    expect(r.resumo.comPesoIncompleto).toBe(0);
  });

  it('o faturado vale mais que o pedido: quantidade e total são os que saíram', async () => {
    const { r } = await listar({
      pedidos: [pedido({ total_faturado: '300.00', itens_faturados: [{ produto_codigo: '1001', quantidade: 3, valor_unitario: 100 }] })],
      produtos: [ACUCAR, PAPEL],
    });
    expect(r.entregas[0]).toMatchObject({ total: 300, volumes: 3, pesoKg: 30, itensSemPeso: 0, itens: 1 });
  });

  it('pedido sem nota recebida aparece, marcado sem nota; origem do vendedor e do site', async () => {
    const { r } = await listar({ pedidos: [pedido({ numero_nf: null, serie: null, emitida_em: null, origem: 'vendedor' }), pedido({ id: 'ped-2', origem: 'site' })], produtos: [ACUCAR, PAPEL] });
    expect(r.entregas.map((e) => [e.origem, e.nota])).toEqual([['vendedor', null], ['site', { numero: '48211', serie: '3' }]]);
  });

  it('nota do televendas: endereço e nome vêm da nota; coordenada do cadastro só com o mesmo CEP', async () => {
    const { r } = await listar({ notas: [nota(), nota({ id: 'ne-2', numero_nf: '48221', cep_cadastro: '54000-000', cliente: null })], produtos: [ACUCAR] });
    expect(r.entregas[0]).toMatchObject({
      id: 'nota:ne-1', origem: 'televendas', pedidoNumero: '123456', cliente: 'Supermercado Litoral', telefone: '8133330000',
      endereco: { logradouro: 'Av. Bernardo Vieira de Melo', numero: '1820', complemento: 'Doca lateral', bairro: 'Candeias', cidade: 'JABOATAO DOS GUARARAPES', uf: 'PE', cep: '54440620' },
      latitude: -8.2, longitude: -34.93, volumes: 20, pesoKg: 200, itensSemPeso: 0,
    });
    expect(r.entregas[1]).toMatchObject({ cliente: 'SUPERMERCADO LITORAL LTDA', latitude: null, longitude: null, endereco: { complemento: null } });
    expect(r.resumo).toMatchObject({ entregas: 2, pesoKg: 400, semLocalizacao: 1 });
  });

  it('produto que não está no cadastro: o peso sai do nome escrito na nota', async () => {
    const { r } = await listar({ notas: [nota({ itens: [{ codigo: '9999', descricao: 'AGUA SANITARIA DRAGAO 2L CX6', quantidade: 10 }] })] });
    expect(r.entregas[0]).toMatchObject({ pesoKg: 120, itensSemPeso: 0 });
  });

  it('volumes e peso que a própria nota informa vencem a estimativa', async () => {
    const { r } = await listar({ notas: [nota({ volumes: '26.000', peso_bruto_kg: '430.500', itens: [{ codigo: '1002', descricao: 'PAPEL', quantidade: 4 }] })], produtos: [PAPEL] });
    expect(r.entregas[0]).toMatchObject({ volumes: 26, pesoKg: 430.5, itensSemPeso: 0 });
  });

  it('nenhum item com peso: peso nulo, não zero', async () => {
    const { r } = await listar({ notas: [nota({ itens: [{ codigo: '1002', descricao: 'PAPEL HIG', quantidade: 4 }] })], produtos: [PAPEL] });
    expect(r.entregas[0]).toMatchObject({ pesoKg: null, itensSemPeso: 1, volumes: 4 });
    expect(r.resumo.pesoKg).toBe(0);
  });

  it('sem nada a entregar não consulta produtos', async () => {
    const { r, query } = await listar({});
    expect(r).toEqual({ resumo: { entregas: 0, volumes: 0, pesoKg: 0, comPesoIncompleto: 0, semLocalizacao: 0 }, entregas: [] });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('from produtos'))).toBe(false);
  });

  it('só olha o que está faturado e é de entrega', async () => {
    const { query } = await listar({});
    const sqls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqls[0]).toContain("p.status = 'FATURADO' and p.tipo_entrega = 'entrega'");
    expect(sqls[1]).toContain("ne.status = 'FATURADO' and ne.tipo_entrega = 'entrega'");
  });
});
