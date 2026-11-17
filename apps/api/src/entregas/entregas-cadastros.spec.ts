import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { caminhoDaRequisicao, solucaoExigida, solucoesEfetivas } from '../admin/solucoes';
import { runComTenant } from '../tenancy/tenant-context';
import { EntregasCadastrosController, normalizarPlaca } from './entregas-cadastros.controller';

type Resposta = { rows?: unknown[]; rowCount?: number } | Error;

/** Pool falso: cada regra é (trecho do SQL → resposta). Sem regra = nada encontrado. */
function montar(regras: Array<[string, Resposta]> = []) {
  const query = jest.fn(async (sql: string) => {
    for (const [trecho, resposta] of regras) {
      if (sql.includes(trecho)) {
        if (resposta instanceof Error) throw resposta;
        return { rows: resposta.rows ?? [], rowCount: resposta.rowCount ?? resposta.rows?.length ?? 0 };
      }
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, pool: { query } };
}

const rodar = <T>(pool: unknown, fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
const ctl = () => new EntregasCadastrosController();
const admin = { admin: { usuarioId: 'u1', papel: 'admin', solucoes: ['entregas'] } } as never;
const operador = { admin: { usuarioId: 'u2', papel: 'operador', solucoes: ['entregas'] } } as never;
const ID = '11111111-1111-4111-8111-111111111111';
const erroPg = (code: string, constraint?: string) => Object.assign(new Error('pg'), { code, constraint });

describe('Solução entregas', () => {
  it('rotas /v1/admin/entregas exigem a solução entregas; o comprovante do pedido segue no Delivery', () => {
    expect(solucaoExigida(caminhoDaRequisicao('/v1/admin/entregas/caminhoes')!)).toBe('entregas');
    expect(solucaoExigida(caminhoDaRequisicao('/v1/admin/entregas')!)).toBe('entregas');
    expect(solucaoExigida(caminhoDaRequisicao('/v1/admin/pedidos/abc/entrega')!)).toBe('delivery');
    expect(solucaoExigida(caminhoDaRequisicao('/v1/admin/entregasx')!)).toBe('delivery');
  });

  it('administrador tem as três; operador só as que recebeu', () => {
    expect(solucoesEfetivas('admin', ['delivery'])).toEqual(['delivery', 'vendas', 'entregas']);
    expect(solucoesEfetivas('operador', ['entregas'])).toEqual(['entregas']);
    expect(solucoesEfetivas('operador', undefined)).toEqual(['delivery']);
  });
});

describe('EntregasCadastrosController · caminhões', () => {
  it('normaliza a placa (sem hífen, maiúsculas)', () => {
    expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
    expect(normalizarPlaca('  ')).toBeNull();
    expect(normalizarPlaca(undefined)).toBeNull();
  });

  it('cria o caminhão com placa normalizada e situação ativo por padrão', async () => {
    const { query, pool } = montar([['insert into caminhoes', { rows: [{ id: ID }] }]]);
    const out = await rodar(pool, () =>
      ctl().criarCaminhao({ nome: ' Caminhão 2 ', placa: 'abc-1d23', capacidadeKg: 3500, regiao: ' Jaboatão sul ' } as never),
    );
    expect(out).toEqual({ id: ID });
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into caminhoes'))!;
    expect(insert[1]).toEqual(['Caminhão 2', 'ABC1D23', 3500, null, 'Jaboatão sul', 'ativo']);
  });

  it('nome igual com outra caixa ou espaço sobrando é recusado antes de gravar; o próprio caminhão pode manter o nome', async () => {
    const existentes: [string, { rows: unknown[] }] = ['select id, nome from caminhoes', { rows: [{ id: ID, nome: 'Caminhão 2' }] }];
    const novo = montar([existentes, ['insert into caminhoes', { rows: [{ id: 'x' }] }]]);
    await expect(rodar(novo.pool, () => ctl().criarCaminhao({ nome: '  CAMINHÃO   2 ' } as never))).rejects.toMatchObject({
      constructor: ConflictException, message: 'Já existe um caminhão com este nome',
    });
    expect(novo.query.mock.calls.some(([sql]) => String(sql).includes('insert into caminhoes'))).toBe(false);
    const mesmo = montar([existentes, ['update caminhoes', { rowCount: 1 }]]);
    await expect(rodar(mesmo.pool, () => ctl().atualizarCaminhao(ID, { nome: 'CAMINHÃO 2' } as never))).resolves.toEqual({ ok: true });
  });

  it('nome ou placa repetidos viram 409 com a mensagem certa', async () => {
    const nome = montar([['insert into caminhoes', erroPg('23505', 'caminhoes_nome_unico')]]);
    await expect(rodar(nome.pool, () => ctl().criarCaminhao({ nome: 'Caminhão 2' } as never))).rejects.toMatchObject({
      constructor: ConflictException, message: 'Já existe um caminhão com este nome',
    });
    const placa = montar([['update caminhoes', erroPg('23505', 'caminhoes_placa_unica')]]);
    await expect(rodar(placa.pool, () => ctl().atualizarCaminhao(ID, { nome: 'Caminhão 2', placa: 'ABC1D23' } as never))).rejects.toMatchObject({
      message: 'Já existe um caminhão com esta placa',
    });
  });

  it('motorista inexistente vira 400 e caminhão inexistente vira 404', async () => {
    const fk = montar([['insert into caminhoes', erroPg('23503')]]);
    await expect(rodar(fk.pool, () => ctl().criarCaminhao({ nome: 'X', motoristaId: ID } as never))).rejects.toMatchObject({ message: 'Motorista não encontrado' });
    const { pool } = montar();
    await expect(rodar(pool, () => ctl().atualizarCaminhao(ID, { nome: 'X' } as never))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista devolve a capacidade como número e o nome do motorista', async () => {
    const { pool } = montar([['from caminhoes c', { rows: [{ id: ID, nome: 'Caminhão 2', placa: 'ABC1D23', capacidade_kg: '3500.00', motorista_id: 'm1', motorista_nome: 'Edson', regiao: null, situacao: 'ativo' }] }]]);
    const out = await rodar(pool, () => ctl().caminhoes());
    expect(out).toEqual([{ id: ID, nome: 'Caminhão 2', placa: 'ABC1D23', capacidadeKg: 3500, motoristaId: 'm1', motoristaNome: 'Edson', regiao: null, situacao: 'ativo' }]);
  });
});

describe('EntregasCadastrosController · motoristas', () => {
  it('desativar o motorista encerra as sessões do aplicativo', async () => {
    const { query, pool } = montar([['update motoristas', { rowCount: 1 }]]);
    await rodar(pool, () => ctl().atualizarMotorista(ID, { nome: 'Edson', ativo: false } as never));
    expect(query.mock.calls.some(([sql]) => String(sql).includes("delete from refresh_tokens where sujeito_id = $1 and sujeito = 'motorista'"))).toBe(true);
  });

  it('editar sem desativar não mexe nas sessões', async () => {
    const { query, pool } = montar([['update motoristas', { rowCount: 1 }]]);
    await rodar(pool, () => ctl().atualizarMotorista(ID, { nome: 'Edson', telefone: ' 81 99999-0000 ' } as never));
    expect(query.mock.calls).toHaveLength(1);
    expect(query.mock.calls[0][1]).toEqual([ID, 'Edson', '81 99999-0000', null]);
  });

  it('só administrador define login e senha', async () => {
    const { query, pool } = montar();
    await expect(rodar(pool, () => ctl().definirAcesso(operador, ID, { login: 'edson', senha: 'segredo123', ativo: true } as never))).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('login em uso por outro motorista é recusado', async () => {
    const { pool } = montar([['from motoristas where login', { rows: [{}] }]]);
    await expect(rodar(pool, () => ctl().definirAcesso(admin, ID, { login: 'Edson', ativo: true } as never))).rejects.toBeInstanceOf(ConflictException);
  });

  it('grava o login em minúsculas, a senha com hash e encerra as sessões ao trocar a senha', async () => {
    const { query, pool } = montar([['update motoristas set login', { rowCount: 1 }]]);
    await rodar(pool, () => ctl().definirAcesso(admin, ID, { login: ' Edson.Silva ', senha: 'segredo123', ativo: true } as never));
    const up = query.mock.calls.find(([sql]) => String(sql).includes('update motoristas set login'))!;
    const p = up[1] as unknown[];
    expect(p[1]).toBe('edson.silva');
    expect(String(p[2])).toMatch(/^\$argon2/);
    expect(String(p[2])).not.toContain('segredo123');
    expect(p[3]).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('delete from refresh_tokens'))).toBe(true);
  });

  it('sem senha nova mantém a atual e não derruba a sessão', async () => {
    const { query, pool } = montar([['update motoristas set login', { rowCount: 1 }]]);
    await rodar(pool, () => ctl().definirAcesso(admin, ID, { login: 'edson', ativo: true } as never));
    const up = query.mock.calls.find(([sql]) => String(sql).includes('update motoristas set login'))!;
    expect((up[1] as unknown[])[2]).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('delete from refresh_tokens'))).toBe(false);
  });
});
