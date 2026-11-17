import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runComTenant } from '../tenancy/tenant-context';
import { CargasService, hojeEmRecife } from './cargas.service';
import { EntregasCargasController } from './entregas-cargas.controller';
import type { EntregaPendente } from './notas-a-entregar.service';

const CARGA = '11111111-1111-4111-8111-111111111111';
const L1 = '22222222-2222-4222-8222-222222222221';
const L2 = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';

const entrega = (id: string, cliente: string, extra: Partial<EntregaPendente> = {}): EntregaPendente => ({
  id, origem: 'app', pedidoNumero: '417', cliente, telefone: null,
  endereco: { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Prazeres', cidade: 'Jaboatão dos Guararapes', uf: 'PE', cep: '54000-000' },
  latitude: null, longitude: null, nota: { numero: '48211', serie: '3' }, emitidaEm: null, total: 100, volumes: 10, pesoKg: 100, itensSemPeso: 0, itens: 1, ...extra,
});

type Regra = [string, { rows?: unknown[]; rowCount?: number } | Error];

/** Pool falso: a primeira regra cujo trecho aparece no SQL responde. Sem regra = nada. */
function montar(regras: Regra[], pendentes: EntregaPendente[] = []) {
  const query = jest.fn(async (sql: string) => {
    for (const [trecho, resposta] of regras) {
      if (sql.includes(trecho)) {
        if (resposta instanceof Error) throw resposta;
        return { rows: resposta.rows ?? [], rowCount: resposta.rowCount ?? resposta.rows?.length ?? 0 };
      }
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const servico = new CargasService({ listar: async () => ({ resumo: {}, entregas: pendentes }) } as never);
  const rodar = <T>(fn: (s: CargasService) => Promise<T>) => runComTenant({ tenant: { nomeFantasia: 'CAHU' }, pool } as never, () => fn(servico));
  return { query, rodar };
}

const status = (s: string): Regra => ['select status from cargas where id', { rows: [{ status: s }] }];
const cargaCompleta = (extra: Record<string, unknown> = {}): Regra => ['from cargas c', {
  rows: [{ id: CARGA, numero: '7', data: '2026-11-18', status: 'rascunho', sugerida: true, autorizada_em: null,
    caminhao_id: 'k1', caminhao_nome: 'Caminhão 2', placa: 'ABC1D23', capacidade_kg: '3500.00', motorista_id: 'm1', motorista_nome: 'Edson', ...extra }],
}];
const linhasDaCarga = (linhas: unknown[]): Regra => ['from carga_entregas', { rows: linhas }];
const linha = (id: string, ordem: number, cliente: string) => ({
  id, carga_id: CARGA, ordem, pedido_id: PEDIDO, nota_entrega_id: null, dados_json: entrega(`pedido:${PEDIDO}`, cliente), volumes: '10.000', peso_kg: '100.000', itens_sem_peso: 0, status: 'pendente',
});
const erroPg = (code: string, constraint?: string) => Object.assign(new Error('pg'), { code, constraint });

describe('hojeEmRecife', () => {
  it('usa o calendário de Recife, não o do servidor', () => {
    expect(hojeEmRecife(new Date('2026-11-18T02:30:00Z'))).toBe('2026-11-17'); // 23:30 do dia 17 em Recife
    expect(hojeEmRecife(new Date('2026-11-18T03:00:00Z'))).toBe('2026-11-18');
  });
});

describe('CargasService · só rascunho pode ser alterado', () => {
  it.each([
    ['autorizada', 'Esta carga já foi autorizada. Reabra a carga para mexer nela.'],
    ['em_rota', 'Esta carga já saiu e não pode mais ser alterada.'],
    ['encerrada', 'Esta carga já saiu e não pode mais ser alterada.'],
  ])('carga %s recusa tirar, incluir, reordenar, trocar caminhão e excluir', async (s, mensagem) => {
    const { rodar, query } = montar([status(s)], [entrega(`pedido:${PEDIDO}`, 'A')]);
    for (const acao of [
      (x: CargasService) => x.remover(CARGA, L1), (x: CargasService) => x.adicionar(CARGA, `pedido:${PEDIDO}`),
      (x: CargasService) => x.reordenar(CARGA, [L1]), (x: CargasService) => x.definir(CARGA, null, null), (x: CargasService) => x.excluir(CARGA),
    ]) {
      await expect(rodar(acao)).rejects.toMatchObject({ constructor: BadRequestException, message: mensagem });
    }
    expect(query.mock.calls.every(([sql]) => String(sql).includes('select status from cargas'))).toBe(true);
  });

  it('carga inexistente é 404', async () => {
    const { rodar } = montar([]);
    await expect(rodar((x) => x.excluir(CARGA))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CargasService · ajustes', () => {
  it('incluir: entrega que não está mais aguardando é 404; identificador torto é 400', async () => {
    const { rodar } = montar([status('rascunho')], []);
    await expect(rodar((x) => x.adicionar(CARGA, `pedido:${PEDIDO}`))).rejects.toBeInstanceOf(NotFoundException);
    await expect(rodar((x) => x.adicionar(CARGA, 'qualquer'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('incluir: entrega já em outra carga vira 409; grava no fim da fila com a cópia dos dados', async () => {
    const pendente = entrega(`pedido:${PEDIDO}`, 'Mercadinho');
    const repetida = montar([status('rascunho'), ['coalesce(max(ordem)', { rows: [{ proxima: 3 }] }], ['insert into carga_entregas', erroPg('23505', 'carga_entregas_pedido_vivo')]], [pendente]);
    await expect(repetida.rodar((x) => x.adicionar(CARGA, pendente.id))).rejects.toMatchObject({ constructor: ConflictException, message: 'Esta entrega já está em outra carga.' });
    const ok = montar([status('rascunho'), ['coalesce(max(ordem)', { rows: [{ proxima: 3 }] }]], [pendente]);
    await ok.rodar((x) => x.adicionar(CARGA, pendente.id));
    const insert = ok.query.mock.calls.find(([sql]) => String(sql).includes('insert into carga_entregas'))!;
    expect(insert[1]).toEqual([CARGA, 3, PEDIDO, null, JSON.stringify(pendente), 10, 100, 0]);
  });

  it('reordenar exige exatamente as mesmas entregas', async () => {
    const base: Regra[] = [status('rascunho'), ['select id from carga_entregas', { rows: [{ id: L1 }, { id: L2 }] }]];
    for (const ids of [[L1], [L1, L1], [L1, '99999999-9999-4999-8999-999999999999'], [L1, L2, L2]]) {
      const { rodar, query } = montar(base);
      await expect(rodar((x) => x.reordenar(CARGA, ids))).rejects.toBeInstanceOf(BadRequestException);
      expect(query.mock.calls.some(([sql]) => String(sql).includes('update carga_entregas'))).toBe(false);
    }
    const { rodar, query } = montar(base);
    await rodar((x) => x.reordenar(CARGA, [L2, L1]));
    expect(query.mock.calls.find(([sql]) => String(sql).includes('with ordinality'))![1]).toEqual([CARGA, [L2, L1]]);
  });

  it('caminhão que já tem carga no dia vira 409; caminhão ou motorista inexistente vira 400', async () => {
    const ocupado = montar([status('rascunho'), ['update cargas set caminhao_id', erroPg('23505', 'cargas_caminhao_dia')]]);
    await expect(ocupado.rodar((x) => x.definir(CARGA, 'k1', 'm1'))).rejects.toMatchObject({ constructor: ConflictException, message: 'Este caminhão já tem carga neste dia.' });
    const sumiu = montar([status('rascunho'), ['update cargas set caminhao_id', erroPg('23503')]]);
    await expect(sumiu.rodar((x) => x.definir(CARGA, 'k1', 'm1'))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CargasService.autorizar', () => {
  const situacaoOk: Regra = ['select situacao from caminhoes', { rows: [{ caminhao: 'ativo', motorista: true }] }];

  it.each([
    ['vazia', [status('rascunho'), cargaCompleta(), linhasDaCarga([])] as Regra[], 'A carga está vazia. Inclua ao menos uma entrega.'],
    ['sem caminhão', [status('rascunho'), cargaCompleta({ caminhao_id: null }), linhasDaCarga([linha(L1, 1, 'A')])] as Regra[], 'Escolha o caminhão antes de autorizar.'],
    ['sem motorista', [status('rascunho'), cargaCompleta({ motorista_id: null }), linhasDaCarga([linha(L1, 1, 'A')])] as Regra[], 'Escolha o motorista antes de autorizar.'],
    ['caminhão em manutenção', [status('rascunho'), cargaCompleta(), linhasDaCarga([linha(L1, 1, 'A')]), ['select situacao from caminhoes', { rows: [{ caminhao: 'manutencao', motorista: true }] }]] as Regra[], 'Caminhão 2 não está ativo. Troque o caminhão.'],
    ['motorista desativado', [status('rascunho'), cargaCompleta(), linhasDaCarga([linha(L1, 1, 'A')]), ['select situacao from caminhoes', { rows: [{ caminhao: 'ativo', motorista: false }] }]] as Regra[], 'Edson está desativado. Troque o motorista.'],
  ])('carga %s não é autorizada', async (_caso, regras, mensagem) => {
    const { rodar, query } = montar(regras, [entrega(`pedido:${PEDIDO}`, 'A')]);
    await expect(rodar((x) => x.autorizar(CARGA, 'u1'))).rejects.toMatchObject({ constructor: BadRequestException, message: mensagem });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("set status = 'autorizada'"))).toBe(false);
  });

  it('nota cancelada depois da montagem: recusa dizendo de qual cliente', async () => {
    const { rodar } = montar([status('rascunho'), cargaCompleta(), linhasDaCarga([linha(L1, 1, 'Supermercado Litoral')]), situacaoOk], []);
    await expect(rodar((x) => x.autorizar(CARGA, 'u1'))).rejects.toMatchObject({ message: expect.stringContaining('Supermercado Litoral') });
  });

  it('autoriza, atualizando a cópia dos dados com o peso de agora', async () => {
    const atual = entrega(`pedido:${PEDIDO}`, 'A', { pesoKg: 163, volumes: 12, itensSemPeso: 0 });
    const { rodar, query } = montar([status('rascunho'), cargaCompleta(), linhasDaCarga([linha(L1, 1, 'A')]), situacaoOk, ["set status = 'autorizada'", { rowCount: 1 }]], [atual]);
    expect(await rodar((x) => x.autorizar(CARGA, 'u1'))).toEqual({ ok: true });
    const copia = query.mock.calls.find(([sql]) => String(sql).includes('update carga_entregas set dados_json'))!;
    expect(copia[1]).toEqual([L1, JSON.stringify(atual), 12, 163, 0]);
    expect(query.mock.calls.find(([sql]) => String(sql).includes("set status = 'autorizada'"))![1]).toEqual([CARGA, 'u1']);
  });

  it('outra pessoa mexeu na carga no meio: 409', async () => {
    const { rodar } = montar([status('rascunho'), cargaCompleta(), linhasDaCarga([linha(L1, 1, 'A')]), situacaoOk, ["set status = 'autorizada'", { rowCount: 0 }]], [entrega(`pedido:${PEDIDO}`, 'A')]);
    await expect(rodar((x) => x.autorizar(CARGA, 'u1'))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CargasService.reabrir', () => {
  it('autorizada volta a rascunho; rascunho e carga que já saiu dão a mensagem certa', async () => {
    const ok = montar([["set status = 'rascunho'", { rowCount: 1 }]]);
    expect(await ok.rodar((x) => x.reabrir(CARGA))).toEqual({ ok: true });
    const aberta = montar([["set status = 'rascunho'", { rowCount: 0 }], status('rascunho')]);
    await expect(aberta.rodar((x) => x.reabrir(CARGA))).rejects.toMatchObject({ message: 'Esta carga já está aberta para ajuste.' });
    const saiu = montar([["set status = 'rascunho'", { rowCount: 0 }], status('em_rota')]);
    await expect(saiu.rodar((x) => x.reabrir(CARGA))).rejects.toMatchObject({ message: 'Carga que já saiu não pode ser reaberta.' });
    const nada = montar([["set status = 'rascunho'", { rowCount: 0 }]]);
    await expect(nada.rodar((x) => x.reabrir(CARGA))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EntregasCargasController', () => {
  it('data ausente ou inválida cai em hoje; data válida passa adiante', async () => {
    const painel = jest.fn(async () => ({}));
    const ctl = new EntregasCargasController({ painel } as never);
    await ctl.painel('2026-11-18');
    expect(painel).toHaveBeenLastCalledWith('2026-11-18');
    await ctl.painel('18/11/2026');
    expect(painel).toHaveBeenLastCalledWith(hojeEmRecife());
    await ctl.painel(undefined);
    expect(painel).toHaveBeenLastCalledWith(hojeEmRecife());
  });

  it('valida os corpos: data, entrega e lista de ordem', async () => {
    const tipos = (metodo: string) => Reflect.getMetadata('design:paramtypes', EntregasCargasController.prototype, metodo) as Array<new () => object>;
    const erros = async (Dto: new () => object, corpo: unknown) => (await validate(plainToInstance(Dto, corpo) as object)).length;
    const [, Data] = tipos('sugerir');
    expect(await erros(Data, { data: '2026-11-18' })).toBe(0);
    expect(await erros(Data, { data: '2026-13-40' })).toBeGreaterThan(0);
    expect(await erros(Data, {})).toBeGreaterThan(0);
    const [, Incluir] = tipos('incluir');
    expect(await erros(Incluir, { entregaId: `nota:${PEDIDO}` })).toBe(0);
    expect(await erros(Incluir, { entregaId: PEDIDO })).toBeGreaterThan(0);
    const [, Ordem] = tipos('ordem');
    expect(await erros(Ordem, { ids: [L1, L2] })).toBe(0);
    expect(await erros(Ordem, { ids: [L1, L1] })).toBeGreaterThan(0);
    expect(await erros(Ordem, { ids: ['x'] })).toBeGreaterThan(0);
  });
});
