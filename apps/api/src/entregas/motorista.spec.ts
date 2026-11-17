import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runComTenant } from '../tenancy/tenant-context';
import { MotoristaAuthService, MotoristaGuard } from './motorista-auth';
import { MotoristaController } from './motorista.controller';
import { agruparParadas, distanciaM, horaDoCelular } from './motorista.service';

const tenant = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU Distribuidora' };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('funções do aplicativo do motorista', () => {
  it('distância entre dois pontos em metros', () => {
    expect(distanciaM({ lat: -8.16, lng: -34.92 }, { lat: -8.16, lng: -34.92 })).toBe(0);
    const d = distanciaM({ lat: -8.16, lng: -34.92 }, { lat: -8.1726, lng: -34.92 }); // ~1,4 km para o sul
    expect(d).toBeGreaterThan(1350);
    expect(d).toBeLessThan(1450);
  });

  it('hora do celular: usa a informada; inválida ou no futuro vira agora', () => {
    const agora = new Date('2026-11-18T12:00:00Z');
    expect(horaDoCelular('2026-11-18T08:26:00-03:00', agora).toISOString()).toBe('2026-11-18T11:26:00.000Z');
    expect(horaDoCelular('2026-11-18T08:00:00Z', agora).toISOString()).toBe('2026-11-18T08:00:00.000Z');
    expect(horaDoCelular('2026-11-18T12:04:00Z', agora).toISOString()).toBe('2026-11-18T12:04:00.000Z'); // relógio adiantado até 5 min tolera
    expect(horaDoCelular('2026-11-19T08:00:00Z', agora)).toBe(agora);
    expect(horaDoCelular('qualquer', agora)).toBe(agora);
    expect(horaDoCelular(undefined, agora)).toBe(agora);
  });

  it('notas seguidas do mesmo cliente no mesmo endereço viram uma parada', () => {
    const l = (id: string, cliente: string, numero = '10') => ({ id, dados_json: { cliente, endereco: { logradouro: 'Rua A', numero, bairro: 'Centro' } } as never });
    expect(agruparParadas([l('1', 'A'), l('2', 'a '), l('3', 'B'), l('4', 'A'), l('5', 'A', '20')])).toEqual([['1', '2'], ['3'], ['4'], ['5']]);
  });
});

describe('MotoristaAuthService', () => {
  function montar(motorista: Record<string, unknown> | null) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from motoristas where login')) return { rows: motorista ? [motorista] : [], rowCount: motorista ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    });
    const jwt = { signAsync: jest.fn(async () => 'token') };
    const limite = { conferir: jest.fn(), registrarFalha: jest.fn(), limpar: jest.fn() };
    const servico = new MotoristaAuthService(jwt as never, limite as never);
    const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant, pool: { query } } as never, fn);
    return { servico, query, jwt, limite, rodar };
  }

  it('entra com login e senha, emite token do tipo motorista e guarda a versão do app', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, jwt, query, rodar } = montar({ id: 'm1', nome: 'Edson', senha_hash, ativo: true });
    const out = await rodar(() => servico.login(' EDSON ', 'segredo123', '1.1.1.1', '1.0.0+3'));
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'm1', slug: 'cahu', tipo: 'motorista' });
    expect(out).toMatchObject({ accessToken: 'token', motorista: { id: 'm1', nome: 'Edson' }, distribuidora: 'CAHU Distribuidora' });
    expect(query.mock.calls.find(([sql]) => String(sql).includes('from motoristas where login'))![1]).toEqual(['edson']);
    expect(query.mock.calls.find(([sql]) => String(sql).includes('update motoristas set ultimo_acesso_em'))![1]).toEqual(['m1', '1.0.0+3']);
    expect(String(query.mock.calls.find(([sql]) => String(sql).includes('insert into refresh_tokens'))![0])).toContain("'motorista'");
  });

  it.each([
    ['senha errada', { id: 'm1', nome: 'E', ativo: true }, 'errada'],
    ['motorista bloqueado', { id: 'm1', nome: 'E', ativo: false }, 'segredo123'],
    ['sem senha definida', { id: 'm1', nome: 'E', ativo: true, senha_hash: null }, 'segredo123'],
    ['login que não existe', null, 'segredo123'],
  ])('%s: recusa e conta a falha', async (_c, m, senha) => {
    const motorista = m && !('senha_hash' in m) ? { ...m, senha_hash: await argon2.hash('segredo123') } : m;
    const { servico, limite, rodar } = montar(motorista);
    await expect(rodar(() => servico.login('edson', senha, '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limite.registrarFalha).toHaveBeenCalledWith(['mot:edson', 'ip:1.1.1.1']);
  });

  it('refresh só aceita token de motorista ativo', async () => {
    const { servico, query, rodar } = montar(null);
    await expect(rodar(() => servico.refresh('x'))).rejects.toBeInstanceOf(UnauthorizedException);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("r.sujeito = 'motorista'");
    expect(sql).toContain('m.ativo');
  });
});

describe('MotoristaGuard', () => {
  const ctx = (auth?: string) => {
    const req: Record<string, unknown> = { headers: auth ? { authorization: auth } : {} };
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never };
  };
  const guard = (payload: unknown, ativo = true) => {
    const query = jest.fn(async () => ({ rowCount: ativo ? 1 : 0, rows: [] }));
    const g = new MotoristaGuard({ verifyAsync: jest.fn(async () => payload) } as never);
    return { g, rodar: <T>(fn: () => Promise<T>) => runComTenant({ tenant, pool: { query } } as never, fn) };
  };

  it('aceita token de motorista ativo do mesmo tenant', async () => {
    const { g, rodar } = guard({ sub: 'm1', slug: 'cahu', tipo: 'motorista' });
    const { req, ctx: c } = ctx('Bearer t');
    expect(await rodar(() => g.canActivate(c))).toBe(true);
    expect(req.motorista).toEqual({ motoristaId: 'm1' });
  });

  it.each([
    ['sem token', undefined, { sub: 'm1', slug: 'cahu', tipo: 'motorista' }, true],
    ['token de vendedor', 'Bearer t', { sub: 'm1', slug: 'cahu', tipo: 'vendedor' }, true],
    ['token de outra distribuidora', 'Bearer t', { sub: 'm1', slug: 'outra', tipo: 'motorista' }, true],
    ['motorista bloqueado', 'Bearer t', { sub: 'm1', slug: 'cahu', tipo: 'motorista' }, false],
  ])('%s: 401', async (_c, auth, payload, ativo) => {
    const { g, rodar } = guard(payload, ativo);
    await expect(rodar(() => g.canActivate(ctx(auth).ctx))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('MotoristaController · validação dos formulários', () => {
  const tipos = (metodo: string) => Reflect.getMetadata('design:paramtypes', MotoristaController.prototype, metodo) as Array<new () => object>;
  const erros = async (Dto: new () => object, corpo: unknown) => {
    const obj = plainToInstance(Dto, corpo);
    return { n: (await validate(obj as object)).length, obj: obj as Record<string, unknown> };
  };

  it('formulário com foto: lista de paradas e coordenadas chegam como texto e são convertidas', async () => {
    const [, , Entregue] = tipos('entregue');
    const r = await erros(Entregue, { linhaIds: `${U1},${U2}`, recebedorNome: 'Luciana', lat: '-8.16', lng: '-34.92', em: '2026-11-18T09:26:00-03:00' });
    expect(r.n).toBe(0);
    expect(r.obj.linhaIds).toEqual([U1, U2]);
    expect(r.obj.lat).toBe(-8.16);
    expect((await erros(Entregue, { linhaIds: JSON.stringify([U1]), recebedorNome: 'Luciana' })).obj.linhaIds).toEqual([U1]);
    expect((await erros(Entregue, { linhaIds: U1, recebedorNome: 'L' })).n).toBeGreaterThan(0); // nome curto demais
    expect((await erros(Entregue, { linhaIds: '', recebedorNome: 'Luciana' })).n).toBeGreaterThan(0);
    expect((await erros(Entregue, { linhaIds: 'abc', recebedorNome: 'Luciana' })).n).toBeGreaterThan(0);
  });

  it('não entregue exige um motivo conhecido; ocorrência exige tipo e id do celular', async () => {
    const [, , NaoEntregue] = tipos('naoEntregue');
    expect((await erros(NaoEntregue, { linhaIds: U1, motivo: 'cliente_fechado' })).n).toBe(0);
    expect((await erros(NaoEntregue, { linhaIds: U1, motivo: 'chuva' })).n).toBeGreaterThan(0);
    const [, , Ocorrencia] = tipos('ocorrencia');
    expect((await erros(Ocorrencia, { id: U2, linhaId: U1, tipo: 'avaria', quantidade: '2' })).n).toBe(0);
    expect((await erros(Ocorrencia, { id: 'x', linhaId: U1, tipo: 'avaria' })).n).toBeGreaterThan(0);
    expect((await erros(Ocorrencia, { id: U2, linhaId: U1, tipo: 'sumiu' })).n).toBeGreaterThan(0);
  });

  it('posições: lote de até 500 pontos com hora', async () => {
    const [, Posicoes] = tipos('posicoes');
    const ponto = { lat: -8.1, lng: -34.9, precisaoM: 12, em: '2026-11-18T09:00:00Z' };
    expect((await erros(Posicoes, { pontos: [ponto] })).n).toBe(0);
    expect((await erros(Posicoes, { pontos: [{ ...ponto, lat: 200 }] })).n).toBeGreaterThan(0);
    expect((await erros(Posicoes, { pontos: [{ lat: -8.1, lng: -34.9 }] })).n).toBeGreaterThan(0);
    expect((await erros(Posicoes, { pontos: Array.from({ length: 501 }, () => ponto) })).n).toBeGreaterThan(0);
  });

});
