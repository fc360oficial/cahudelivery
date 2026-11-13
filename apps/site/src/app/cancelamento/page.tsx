import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PaginaTexto } from '@/componentes/PaginaTexto';
import { buscarConfig } from '@/lib/api/catalogo';

export const revalidate = 60;
export const metadata: Metadata = { title: 'Cancelamento e devolução' };

export default async function PaginaCancelamento() {
  const config = await buscarConfig();
  if (!config.politicaCancelamento) notFound();
  return <PaginaTexto titulo="Cancelamento e devolução" texto={config.politicaCancelamento} />;
}
