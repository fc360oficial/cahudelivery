export interface ItemRecebido {
  produtoId: string;
  quantidade: number;
  precoUnit: number;
}

export interface DadosAtuais {
  precos: Map<string, number>;
  estoques: Map<string, number>;
  nomes: Map<string, string>;
  creditoDisponivel: number | null;
  exigeCredito: boolean;
}

export interface Divergencia {
  tipo: 'preco' | 'sem_preco' | 'estoque' | 'credito';
  produtoId?: string;
  nome?: string;
  enviado?: number;
  atual?: number;
}

export function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Compara o pedido que saiu do celular com o que o ERP diz AGORA. Não calcula
 * preço: só confere o valor enviado contra `precos` da tabela escolhida.
 */
export function conferirPedido(
  itens: ItemRecebido[],
  dados: DadosAtuais,
): { divergencias: Divergencia[]; totalAtual: number } {
  const divergencias: Divergencia[] = [];
  let totalAtual = 0;
  for (const item of itens) {
    const nome = dados.nomes.get(item.produtoId);
    const atual = dados.precos.get(item.produtoId);
    if (atual === undefined) {
      divergencias.push({
        tipo: 'sem_preco',
        produtoId: item.produtoId,
        nome,
        enviado: item.precoUnit,
      });
    } else {
      totalAtual += atual * item.quantidade;
      if (Math.abs(atual - item.precoUnit) >= 0.005) {
        divergencias.push({
          tipo: 'preco',
          produtoId: item.produtoId,
          nome,
          enviado: item.precoUnit,
          atual,
        });
      }
    }
    const estoque = dados.estoques.get(item.produtoId) ?? 0;
    if (estoque < item.quantidade) {
      divergencias.push({
        tipo: 'estoque',
        produtoId: item.produtoId,
        nome,
        enviado: item.quantidade,
        atual: estoque,
      });
    }
  }
  totalAtual = arredondar(totalAtual);
  if (
    dados.exigeCredito &&
    dados.creditoDisponivel !== null &&
    totalAtual > dados.creditoDisponivel
  ) {
    divergencias.push({
      tipo: 'credito',
      enviado: totalAtual,
      atual: dados.creditoDisponivel,
    });
  }
  return { divergencias, totalAtual };
}
