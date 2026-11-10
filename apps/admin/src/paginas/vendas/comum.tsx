import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Selo, type VarianteSelo } from '../../vendas-ui';
import './inicio-pedidos.css';

export interface VendedorOpcao { id: string; nome: string }

/** Lista de vendedores para o filtro; falha silenciosa (o filtro fica só com "Todos"). */
export function useVendedores() {
  const [lista, setLista] = useState<VendedorOpcao[] | null>(null);
  useEffect(() => {
    api<VendedorOpcao[]>('/admin/vendas/vendedores').then((r) => setLista(Array.isArray(r) ? r : [])).catch(() => setLista([]));
  }, []);
  return lista;
}

const STATUS: Record<string, [string, VarianteSelo]> = {
  AGUARDANDO_VENDEDOR: ['Retido', 'amarelo'],
  RECEBIDO: ['Aguardando o ERP', 'azul'],
  ENVIADO_ERP: ['No ERP', 'cinza'],
  ABERTO: ['No ERP', 'cinza'],
  EM_FATURAMENTO: ['No ERP', 'cinza'],
  FATURADO: ['Faturado', 'verde'],
  CANCELADO: ['Cancelado', 'vermelho'],
};

export function SeloStatus({ status }: { status: string }) {
  const [rotulo, variante] = STATUS[status] ?? [status, 'cinza' as VarianteSelo];
  return <Selo variante={variante}>{rotulo}</Selo>;
}

export interface Divergencia { tipo: string; nome?: string; enviado?: number; atual?: number }

export const MOTIVO: Record<string, string> = {
  preco: 'Preço mudou',
  sem_preco: 'Produto sem preço na tabela',
  estoque: 'Sem estoque',
  credito: 'Limite de crédito',
};

export function SeletorVendedor({ id, valor, onChange, vendedores }: { id: string; valor: string; onChange: (v: string) => void; vendedores: VendedorOpcao[] | null }) {
  return (
    <select id={id} aria-label="Vendedor" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todos os vendedores</option>
      {vendedores?.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
    </select>
  );
}
