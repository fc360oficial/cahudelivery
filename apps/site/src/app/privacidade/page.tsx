import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PaginaTexto } from '@/componentes/PaginaTexto';
import { buscarConfig } from '@/lib/api/catalogo';

export const revalidate = 60;
export const metadata: Metadata = { title: 'Política de privacidade' };

export default async function PaginaPrivacidade() {
  const config = await buscarConfig();
  if (!config.politicaPrivacidade) notFound();
  return <PaginaTexto titulo="Política de privacidade" texto={config.politicaPrivacidade} />;
}
