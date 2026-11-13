'use client';

import type { ReactNode } from 'react';
import type { Rotulo, Tom } from '@/lib/conta/status';
import estilos from './Conta.module.css';

const TONS: Record<Tom, string> = {
  positivo: estilos.tomPositivo,
  alerta: estilos.tomAlerta,
  perigo: estilos.tomPerigo,
  andamento: estilos.tomAndamento,
  neutro: estilos.tomNeutro,
};

export function Etiqueta({ rotulo }: { rotulo: Rotulo }) {
  return <span className={`${estilos.etiqueta} ${TONS[rotulo.tom]}`}>{rotulo.rotulo}</span>;
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className={estilos.estado} role="status" aria-live="polite">{texto}</div>;
}

export function ErroCarga({ mensagem, aoTentar }: { mensagem: string | null; aoTentar: () => void }) {
  return (
    <div className={estilos.estado} role="alert">
      <p>{mensagem ?? 'Não foi possível carregar.'}</p>
      <button type="button" className={estilos.secundario} onClick={aoTentar}>Tentar de novo</button>
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className={estilos.estado}>
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}

/** Mensagem de resultado de uma ação (erro em vermelho, sucesso em verde). */
export function Aviso({ tipo, children }: { tipo: 'erro' | 'sucesso' | 'info'; children: ReactNode }) {
  const classe = tipo === 'erro' ? estilos.erro : tipo === 'sucesso' ? estilos.sucesso : estilos.info;
  return <p className={classe} role={tipo === 'erro' ? 'alert' : 'status'}>{children}</p>;
}
