import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarTodosProdutos } from './catalogo';

const produto = (n: number) => ({ id: `p${n}`, nome: `Produto ${n}`, unidade_venda: 'CX', qtd_por_embalagem: 12, preco: '10.00', preco_tabela: '10.00', estoque: '5', imagens: [] });
const lote = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => produto(de + i));
const resposta = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo }) as Response;

describe('buscarTodosProdutos (lista inteira, sem páginas)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('junta os lotes de 50 da API até acabar e não repete produto', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      chamadas.push(String(url));
      const pagina = Number(new URL(String(url)).searchParams.get('pagina'));
      // o produto 50 "escorrega" para o segundo lote (mudou de posição entre as chamadas)
      if (pagina === 1) return resposta({ dados: lote(1, 50), pagina: 1, temMais: true });
      if (pagina === 2) return resposta({ dados: lote(50, 99), pagina: 2, temMais: true });
      return resposta({ dados: lote(100, 104), pagina: 3, temMais: false });
    }));
    const r = await buscarTodosProdutos({ categoria: 'cat-1', ordem: 'nome' });
    expect(r.dados).toHaveLength(104);
    expect(new Set(r.dados.map((p) => p.id)).size).toBe(104);
    expect(r.temMais).toBe(false);
    expect(r.pagina).toBe(1);
    expect(chamadas).toHaveLength(3);
    expect(chamadas[0]).toContain('limite=50');
    expect(chamadas[0]).toContain('categoria=cat-1');
  });

  it('categoria pequena: uma chamada só', async () => {
    const chamada = vi.fn(async () => resposta({ dados: lote(1, 12), pagina: 1, temMais: false }));
    vi.stubGlobal('fetch', chamada);
    const r = await buscarTodosProdutos({ promocao: true, ordem: 'preco_asc' });
    expect(r.dados).toHaveLength(12);
    expect(chamada).toHaveBeenCalledTimes(1);
  });

  it('para no teto de 1000 produtos mesmo se a API continuar dizendo que tem mais', async () => {
    const chamada = vi.fn(async (url: string) => { const p = Number(new URL(String(url)).searchParams.get('pagina')); return resposta({ dados: lote((p - 1) * 50 + 1, p * 50), pagina: p, temMais: true }); });
    vi.stubGlobal('fetch', chamada);
    const r = await buscarTodosProdutos({ busca: 'a', ordem: 'nome' });
    expect(r.dados).toHaveLength(1000);
    expect(chamada).toHaveBeenCalledTimes(20);
  });
});
