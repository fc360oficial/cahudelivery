import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FormularioCadastro } from '@/componentes/FormularioCadastro';
import { buscarConfig } from '@/lib/api/catalogo';
import { COOKIE_ACESSO, COOKIE_RENOVA } from '@/lib/sessao/sessao-cliente';
import { linkWhatsapp } from '@/lib/site';
import estilos from './cadastrar.module.css';

export const metadata: Metadata = { title: 'Criar conta', robots: { index: false, follow: false } };
// Lê os cookies para mandar quem já está logado para a conta.
export const dynamic = 'force-dynamic';

/** Cadastro de cliente novo. Casca no servidor com a config pública; o formulário roda no navegador. */
export default async function PaginaCadastrar() {
  const jar = await cookies();
  if (jar.get(COOKIE_ACESSO)?.value || jar.get(COOKIE_RENOVA)?.value) redirect('/conta');
  const config = await buscarConfig();
  const horario = [
    config.horarioSemana && `Atendimento de segunda a sexta, ${config.horarioSemana}`,
    config.horarioSabado && `Sábado, ${config.horarioSabado}`,
  ].filter((h): h is string => !!h);
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <div className={estilos.cartao}>
        <FormularioCadastro
          appNome={config.appNome}
          whatsapp={linkWhatsapp(config.contatoWhatsapp)}
          horario={horario}
          temPolitica={!!config.politicaPrivacidade}
          indicacoesAtivas={config.indicacoesAtivas}
        />
      </div>
    </div>
  );
}
