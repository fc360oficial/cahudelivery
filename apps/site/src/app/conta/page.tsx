import { VisaoGeral } from '@/componentes/conta/VisaoGeral';
import { buscarConfig } from '@/lib/api/catalogo';

// Só a config pública (com cache) é lida no servidor; os dados do cliente vêm de /api/conta/*.
export default async function PaginaConta() {
  const config = await buscarConfig();
  return <VisaoGeral appNome={config.appNome} />;
}
