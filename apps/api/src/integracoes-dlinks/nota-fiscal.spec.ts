import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, BadRequestException } from '@nestjs/common';
import { extrairChaveDoXml, normalizarCentavos, DlinksPedidosService } from './dlinks-pedidos.service';
import { runComTenant } from '../tenancy/tenant-context';

const XML = readFileSync(join(__dirname, '..', 'notas', 'fixtures', 'nfe-5060.xml'), 'utf8');
const CHAVE = '26260961920643000148550030000050601000073367';

describe('extrairChaveDoXml', () => {
  it('tira o prefixo NFe do atributo Id', () => {
    expect(extrairChaveDoXml(XML)).toBe(CHAVE);
  });

  it('devolve null quando o XML nao tem infNFe', () => {
    expect(extrairChaveDoXml('<nfeProc><nada/></nfeProc>')).toBeNull();
  });

  it('devolve null quando o conteudo nem e XML', () => {
    expect(extrairChaveDoXml('isso nao e xml')).toBeNull();
  });
});

describe('normalizarCentavos', () => {
  it('converte o inteiro em centavos que o Dlinks manda', () => {
    // O payload de 22/09/2026 trouxe total 23400 para uma nota de R$ 234,00.
    expect(normalizarCentavos(23400)).toBe(234);
    expect(normalizarCentavos(0)).toBe(0);
    expect(normalizarCentavos(1)).toBe(0.01);
  });

  it('arredonda para duas casas', () => {
    expect(normalizarCentavos(23401)).toBe(234.01);
  });
});

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

const PEDIDO = '2a2d9a5b-5008-4016-bc23-dd8105434d6e';
const XML_B64 = Buffer.from(XML).toString('base64');

function montar() {
  // Parametros tipados: sem eles o TS tipa mock.calls como [] e o `([sql])` nao compila.
  const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 }));
  // `transicionar` usa pool.connect(); aqui só interessa o caminho pós-transição.
  const client = { query: jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ status: 'ENVIADO_ERP' }], rowCount: 1 })), release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) };
  return { servico: new DlinksPedidosService(), pool, query };
}

const comTenant = (pool: unknown, fn: () => Promise<unknown>) =>
  runComTenant({ tenant: { slug: 'cahu' }, pool } as never, fn);

describe('gravacao da nota fiscal', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
    process.env.PUBLIC_URL = 'https://cahudelivery.duckdns.org';
  });

  const nota = { chave: CHAVE, numero: '5060', serie: '3', emitida_em: '2026-09-22T00:00:00-03:00', xml_base64: XML_B64 };
  const dto = (extra: Record<string, unknown> = {}) => ({
    pedido_codigo: PEDIDO,
    status: 'FATURADO' as const,
    valores: { subtotal: 23400, desconto: 0, total: 23400 },
    itens: [{ produto_codigo: '7891008367027', quantidade: 6, valor_unitario: 39 }],
    nota_fiscal: nota,
    ...extra,
  });

  it('grava a nota com XML decodificado e URLs assinadas', async () => {
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto() as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into pedido_notas'));
    expect(insert).toBeDefined();
    const params = insert![1] as unknown[];
    expect(params[1]).toBe('5060');          // numero_nf
    expect(params[2]).toBe('3');             // serie
    expect(params[3]).toBe(CHAVE);           // chave_acesso
    expect(String(params[4])).toContain('<nNF>5060</nNF>'); // xml decodificado, nao base64
    expect(String(params[5])).toContain(`/v1/notas/cahu/${PEDIDO}/nota.xml?t=`);
    expect(String(params[6])).toContain(`/v1/notas/cahu/${PEDIDO}/danfe.pdf?t=`);
    expect(String(insert![0])).toContain('on conflict (pedido_id) do update'); // reenvio atualiza
  });

  it('normaliza os centavos do payload ao gravar o faturamento', async () => {
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto() as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into pedido_faturamentos'));
    const params = insert![1] as unknown[];
    expect(params[1]).toBe(234); // subtotal, nao 23400
    expect(params[3]).toBe(234); // total
  });

  it('recusa quando a chave do payload diverge da chave do XML', async () => {
    const { servico, pool, query } = montar();
    const chaveErrada = { ...nota, chave: `1${CHAVE.slice(1)}` };
    await expect(
      comTenant(pool, () => servico.marcarFaturado(dto({ nota_fiscal: chaveErrada }) as never)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into pedido_notas'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('nota_chave_divergente'))).toBe(true);
  });

  it('recusa quando o xml_base64 nao contem uma NF-e', async () => {
    const { servico, pool } = montar();
    const lixo = { ...nota, xml_base64: Buffer.from('nao e xml').toString('base64') };
    await expect(
      comTenant(pool, () => servico.marcarFaturado(dto({ nota_fiscal: lixo }) as never)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava a nota sem URLs quando PUBLIC_URL nao esta configurada', async () => {
    delete process.env.PUBLIC_URL;
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto() as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into pedido_notas'));
    const params = insert![1] as unknown[];
    expect(params[5]).toBeNull(); // xml_url
    expect(params[6]).toBeNull(); // pdf_url
  });

  it('nao grava nota quando o status do payload nao e FATURADO', async () => {
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto({ status: 'EM_FATURAMENTO' }) as never));
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into pedido_notas'))).toBe(false);
  });
});
