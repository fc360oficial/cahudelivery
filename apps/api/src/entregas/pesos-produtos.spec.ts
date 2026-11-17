import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runComTenant } from '../tenancy/tenant-context';
import { EntregasPesosController } from './entregas-pesos.controller';
import { PesosProdutosService } from './pesos-produtos.service';

const PRODUTOS = [
  { id: 'p1', sku: '789', erp_produto_id: '1001', nome: 'ACUCAR PETRIBU DEMERARA 1KG FD10', unidade_venda: 'CX', qtd_por_embalagem: '10.000', peso_kg: null },
  { id: 'p2', sku: '456', erp_produto_id: null, nome: 'PAPEL HIG FLORAL NEUTRO C4 30M FD16', unidade_venda: 'CX', qtd_por_embalagem: '16.000', peso_kg: null },
  { id: 'p3', sku: '123', erp_produto_id: '1003', nome: 'SANDÁLIA IPANEMA CLASSICA FEM AZ N35A40 CX6', unidade_venda: 'CX', qtd_por_embalagem: '6.000', peso_kg: '2.400' },
  { id: 'p4', sku: '321', erp_produto_id: '1004', nome: 'FOSFORO GABOARDI FD20', unidade_venda: 'CX', qtd_por_embalagem: '20.000', peso_kg: '0.000' },
];

function montar(regras: { produtos?: unknown[]; atual?: unknown[] } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from produtos where ativo')) return { rows: regras.produtos ?? PRODUTOS, rowCount: (regras.produtos ?? PRODUTOS).length };
    if (sql.includes('select peso_kg from produtos')) return { rows: regras.atual ?? [], rowCount: (regras.atual ?? []).length };
    return { rows: [], rowCount: 1 };
  });
  return { query, pool: { query } };
}
const rodar = <T>(pool: unknown, fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
const servico = () => new PesosProdutosService();

describe('PesosProdutosService.listar', () => {
  it('conta as três situações; peso zero no cadastro não conta como informado', async () => {
    const { pool } = montar();
    const r = await rodar(pool, () => servico().listar('sem'));
    expect(r.resumo).toEqual({ sem: 2, estimado: 1, cadastro: 1 });
    expect(r.produtos.map((p) => p.id)).toEqual(['p2', 'p4']);
    expect(r.total).toBe(2);
    expect(r.produtos[0]).toEqual({ id: 'p2', nome: 'PAPEL HIG FLORAL NEUTRO C4 30M FD16', codigo: '456', unidadeVenda: 'CX', qtdPorEmbalagem: 16, pesoCadastroKg: null, pesoEstimadoKg: null, situacao: 'sem' });
  });

  it('estimado mostra o peso calculado pelo nome; informado mostra o do cadastro e também o que o nome diria', async () => {
    const { pool } = montar();
    expect((await rodar(pool, () => servico().listar('estimado'))).produtos).toEqual([
      expect.objectContaining({ id: 'p1', codigo: '1001', pesoEstimadoKg: 10, pesoCadastroKg: null }),
    ]);
    expect((await rodar(pool, () => servico().listar('cadastro'))).produtos).toEqual([
      expect.objectContaining({ id: 'p3', pesoCadastroKg: 2.4, pesoEstimadoKg: null }),
    ]);
  });

  it('busca pelo nome sem acento ou pelo código, sem mexer nos totais do resumo', async () => {
    const { pool } = montar();
    const porNome = await rodar(pool, () => servico().listar('cadastro', 'sandalia'));
    expect(porNome.produtos.map((p) => p.id)).toEqual(['p3']);
    const porCodigo = await rodar(pool, () => servico().listar('sem', '321'));
    expect(porCodigo.produtos.map((p) => p.id)).toEqual(['p4']);
    expect(porCodigo.total).toBe(1);
    expect(porCodigo.resumo).toEqual({ sem: 2, estimado: 1, cadastro: 1 });
  });

  it('corta a lista em 300 e informa o total', async () => {
    const muitos = Array.from({ length: 320 }, (_, i) => ({ id: `x${i}`, sku: String(i), erp_produto_id: null, nome: `PRENDEDOR ${i} FD50`, unidade_venda: 'CX', qtd_por_embalagem: '50', peso_kg: null }));
    const { pool } = montar({ produtos: muitos });
    const r = await rodar(pool, () => servico().listar('sem'));
    expect(r.total).toBe(320);
    expect(r.produtos).toHaveLength(300);
  });
});

describe('PesosProdutosService.definir', () => {
  it('grava o peso e registra na auditoria quem mudou e o valor anterior', async () => {
    const { query, pool } = montar({ atual: [{ peso_kg: '6.000' }] });
    expect(await rodar(pool, () => servico().definir('p2', 6.5, 'u1'))).toEqual({ ok: true });
    const up = query.mock.calls.find(([sql]) => String(sql).includes('update produtos set peso_kg'))!;
    expect(up[1]).toEqual(['p2', 6.5]);
    const aud = query.mock.calls.find(([sql]) => String(sql).includes('insert into auditoria'))!;
    expect(String(aud[0])).toContain("'definir_peso_produto','produto'");
    expect(aud[1]).toEqual(['u1', 'p2', JSON.stringify({ pesoKg: 6.5, anterior: 6 })]);
  });

  it('nulo apaga o peso informado; produto inexistente é 404 e nada é gravado', async () => {
    const ok = montar({ atual: [{ peso_kg: '6.000' }] });
    await rodar(ok.pool, () => servico().definir('p2', null, 'u1'));
    expect(ok.query.mock.calls.find(([sql]) => String(sql).includes('update produtos'))![1]).toEqual(['p2', null]);
    const nao = montar();
    await expect(rodar(nao.pool, () => servico().definir('p9', 1, 'u1'))).rejects.toBeInstanceOf(NotFoundException);
    expect(nao.query.mock.calls.some(([sql]) => String(sql).includes('update produtos'))).toBe(false);
  });
});

describe('EntregasPesosController', () => {
  it('situação desconhecida cai em "sem"; ausência de peso no corpo vira nulo', async () => {
    const listar = jest.fn(async () => ({}));
    const definir = jest.fn(async () => ({ ok: true }));
    const ctl = new EntregasPesosController({ listar, definir } as never);
    await ctl.listar('qualquer', ' papel ');
    expect(listar).toHaveBeenCalledWith('sem', ' papel ');
    await ctl.listar('estimado');
    expect(listar).toHaveBeenLastCalledWith('estimado', undefined);
    await ctl.definir({ admin: { usuarioId: 'u1' } } as never, 'p1', {} as never);
    expect(definir).toHaveBeenCalledWith('p1', null, 'u1');
  });

  it('valida o corpo: aceita número positivo e nulo; recusa zero, negativo, texto e absurdo', async () => {
    const Dto = Reflect.getMetadata('design:paramtypes', EntregasPesosController.prototype, 'definir')[2];
    const erros = async (corpo: unknown) => (await validate(plainToInstance(Dto, corpo) as object)).length;
    expect(await erros({ pesoKg: 6.5 })).toBe(0);
    expect(await erros({ pesoKg: null })).toBe(0);
    expect(await erros({})).toBe(0);
    expect(await erros({ pesoKg: 0 })).toBeGreaterThan(0);
    expect(await erros({ pesoKg: -1 })).toBeGreaterThan(0);
    expect(await erros({ pesoKg: '6,5' })).toBeGreaterThan(0);
    expect(await erros({ pesoKg: 9000 })).toBeGreaterThan(0);
  });
});
