import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { runComTenant } from '../tenancy/tenant-context';
import { DlinksEntregasService } from './dlinks-entregas.service';
import { ListaOuItemPipe } from './lista-ou-item.pipe';
import { NotaEntregaDto } from './nota-entrega.dto';

const XML = readFileSync(join(__dirname, '..', 'notas', 'fixtures', 'nfe-5060.xml'), 'utf8');
const XML_B64 = Buffer.from(XML, 'utf8').toString('base64');
const CHAVE = '26260961920643000148550030000050601000073367';

function montar(opts: { clientes?: Record<string, string>; notasDoFluxo?: string[]; notasEntrega?: string[] } = {}) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from pedido_notas where chave_acesso')) {
      const tem = (opts.notasDoFluxo ?? []).includes(String(params[0]));
      return { rows: tem ? [{}] : [], rowCount: tem ? 1 : 0 };
    }
    if (sql.includes('from clientes where erp_cliente_id')) {
      const id = (opts.clientes ?? {})[String(params[0])];
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (sql.includes('update notas_entrega set status')) {
      const tem = (opts.notasEntrega ?? []).includes(String(params[0]));
      return { rows: [], rowCount: tem ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { query, pool };
}

const rodar = <T>(pool: unknown, fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
const nota = (extra: Record<string, unknown> = {}, nf: Record<string, unknown> = {}) =>
  ({ nota_fiscal: { chave: CHAVE, numero: '5060', serie: '3', xml_base64: XML_B64, ...nf }, ...extra }) as never;
const gravacao = (query: jest.Mock) => query.mock.calls.find(([sql]) => String(sql).includes('insert into notas_entrega'));

describe('DlinksEntregasService.syncNotasEntrega', () => {
  it('grava a nota de televendas lendo total, itens e destinatário do XML', async () => {
    const { query, pool } = montar({ clientes: { '4521': 'cli-1' } });
    const out = await rodar(pool, () =>
      new DlinksEntregasService().syncNotasEntrega([nota({ pedido_numero: '123456', cliente_codigo: '4521' })]),
    );
    expect(out).toEqual({ processados: 1, ignorados: [] });
    const [sql, p] = gravacao(query)! as [string, unknown[]];
    expect(sql).toContain('on conflict (chave_acesso) do update');
    expect(p[0]).toBe(CHAVE);
    expect(p.slice(1, 9)).toEqual(['5060', '3', '123456', 'televendas', 'cli-1', '4521', 'entrega', 'FATURADO']);
    expect(p[9]).toBe(234); // vNF do XML
    expect(p[10]).toBeNull(); // a nota de exemplo não informa volumes
    expect(p[11]).toBeNull(); // nem peso
    expect(JSON.parse(String(p[12])).endereco.cep).toMatch(/^\d{8}$/);
    expect(JSON.parse(String(p[13])).length).toBeGreaterThan(0);
    expect(p[14]).toBe(XML);
    expect(p[15]).toBeTruthy(); // sem emitida_em no payload, usa a emissão do XML
  });

  it('cliente desconhecido não impede a nota: entra sem vínculo, com o endereço do XML', async () => {
    const { query, pool } = montar();
    const out = await rodar(pool, () => new DlinksEntregasService().syncNotasEntrega([nota({ cliente_codigo: '999' })]));
    expect(out.processados).toBe(1);
    const p = gravacao(query)![1] as unknown[];
    expect(p[5]).toBeNull();
    expect(p[6]).toBe('999');
  });

  it('guarda retirada e origem informadas pelo ERP', async () => {
    const { query, pool } = montar();
    await rodar(pool, () =>
      new DlinksEntregasService().syncNotasEntrega([nota({ tipo_entrega: 'retirada', origem: ' Balcao ' })]),
    );
    const p = gravacao(query)![1] as unknown[];
    expect(p[4]).toBe('balcao');
    expect(p[7]).toBe('retirada');
  });

  it('ignora nota de pedido que nasceu no Fluxo Commerce (já chega por /pedidos-faturados)', async () => {
    const { query, pool } = montar({ notasDoFluxo: [CHAVE] });
    const out = await rodar(pool, () => new DlinksEntregasService().syncNotasEntrega([nota()]));
    expect(out.processados).toBe(0);
    expect(out.ignorados.map((i) => i.motivo)).toEqual(['nota_de_pedido_do_fluxo']);
    expect(gravacao(query)).toBeUndefined();
  });

  it('recusa XML que não é NF-e e chave diferente da do XML, sem devolver o XML no retorno', async () => {
    const { query, pool } = montar();
    const outra = '1'.repeat(44);
    const out = await rodar(pool, () =>
      new DlinksEntregasService().syncNotasEntrega([
        nota({}, { xml_base64: Buffer.from('<x/>').toString('base64') }),
        nota({}, { chave: outra }),
      ]),
    );
    expect(out.processados).toBe(0);
    expect(out.ignorados.map((i) => i.motivo)).toEqual(['xml_invalido', 'chave_divergente']);
    expect(JSON.stringify(out.ignorados)).not.toContain('xml_base64');
    expect(gravacao(query)).toBeUndefined();
  });

  it('FATURADO sem XML é ignorado', async () => {
    const { pool } = montar();
    const out = await rodar(pool, () => new DlinksEntregasService().syncNotasEntrega([nota({}, { xml_base64: undefined })]));
    expect(out.ignorados.map((i) => i.motivo)).toEqual(['xml_ausente']);
  });

  it('CANCELADO sem XML marca a nota que já existe e acusa a que não existe', async () => {
    const outra = '2'.repeat(44);
    const { query, pool } = montar({ notasEntrega: [CHAVE] });
    const out = await rodar(pool, () =>
      new DlinksEntregasService().syncNotasEntrega([
        nota({ status: 'CANCELADO' }, { xml_base64: undefined }),
        nota({ status: 'CANCELADO' }, { chave: outra, xml_base64: undefined }),
      ]),
    );
    expect(out.processados).toBe(1);
    expect(out.ignorados.map((i) => i.motivo)).toEqual(['nota_nao_encontrada']);
    const cancelamentos = query.mock.calls.filter(([sql]) => String(sql).includes('update notas_entrega set status'));
    expect(cancelamentos.map(([, p]) => (p as unknown[])[0])).toEqual([CHAVE, outra]);
  });

  it('CANCELADO com XML regrava a nota como cancelada', async () => {
    const { query, pool } = montar();
    await rodar(pool, () => new DlinksEntregasService().syncNotasEntrega([nota({ status: 'CANCELADO' })]));
    expect((gravacao(query)![1] as unknown[])[8]).toBe('CANCELADO');
  });

  it('registra o lote no log da integração', async () => {
    const { query, pool } = montar();
    await rodar(pool, () => new DlinksEntregasService().syncNotasEntrega([nota()]));
    const log = query.mock.calls.find(([sql]) => String(sql).includes('insert into integracao_logs'));
    expect(log![1]).toEqual(['sync_notas_entrega', '1 nota(s) de entrega, 0 ignorada(s)', true]);
  });
});

describe('NotaEntregaDto (validação do corpo)', () => {
  const pipe = new ListaOuItemPipe(NotaEntregaDto);

  it('aceita item único ou lista e valida o bloco nota_fiscal', async () => {
    const um = await pipe.transform({ nota_fiscal: { chave: CHAVE, numero: '5060', serie: '3' } });
    expect(um).toHaveLength(1);
    expect(um[0]).toBeInstanceOf(NotaEntregaDto);
    expect(plainToInstance(NotaEntregaDto, um[0]).nota_fiscal.chave).toBe(CHAVE);
  });

  it('recusa chave fora do formato, tipo de entrega e status desconhecidos', async () => {
    await expect(
      pipe.transform([{ nota_fiscal: { chave: '123', numero: '1', serie: '1' }, tipo_entrega: 'motoboy', status: 'ABERTO' }]),
    ).rejects.toMatchObject({ response: { statusCode: 400 } });
  });

  it('recusa item sem nota_fiscal', async () => {
    await expect(pipe.transform([{ pedido_numero: '1' }])).rejects.toMatchObject({ response: { statusCode: 400 } });
  });
});
