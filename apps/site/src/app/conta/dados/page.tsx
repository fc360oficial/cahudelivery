import type { Metadata } from 'next';
import { DadosCadastrais } from '@/componentes/conta/DadosCadastrais';
import { buscarConfig } from '@/lib/api/catalogo';

export const metadata: Metadata = { title: 'Dados cadastrais' };

export default async function PaginaDados() {
  const config = await buscarConfig();
  return <DadosCadastrais appNome={config.appNome} />;
}
