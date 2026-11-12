import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { autenticar, recusarOrigem, SEM_CACHE } from '@/lib/sessao/autenticar';
import { validarLogin } from '@/lib/sessao/credenciais';
import { requisicaoSegura } from '@/lib/sessao/requisicao';
import { apagarSessao, tokenValido } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

interface Perfil {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  status?: string | null;
}

const VISITANTE = { logado: false };

/** Quem está no navegador: visitante ou cliente (nome e status). Nunca devolve token. */
export async function GET(req: Request) {
  try {
    const token = await tokenValido(requisicaoSegura(req.headers, req.url));
    if (!token) return NextResponse.json(VISITANTE, { headers: SEM_CACHE });
    const perfil = await chamarApi<Perfil>('/perfil', { token });
    const nome = perfil.nome_fantasia?.trim() || perfil.razao_social?.trim() || '';
    return NextResponse.json({ logado: true, nome, status: perfil.status ?? null }, { headers: SEM_CACHE });
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) {
      await apagarSessao();
      return NextResponse.json(VISITANTE, { headers: SEM_CACHE });
    }
    return NextResponse.json(
      { mensagem: 'Não foi possível conferir sua sessão. Tente novamente.' },
      { status: e instanceof ErroApi && e.status === 503 ? 503 : 500, headers: SEM_CACHE },
    );
  }
}

/** Entrar com CNPJ/CPF e senha. */
export async function POST(req: Request) {
  const recusa = recusarOrigem(req);
  if (recusa) return recusa;
  const dados = validarLogin(await req.json().catch(() => null));
  if (!dados) {
    return NextResponse.json(
      { mensagem: 'Informe um CNPJ ou CPF válido e a senha.' },
      { status: 400, headers: SEM_CACHE },
    );
  }
  return autenticar(req, '/auth/login', dados);
}

/** Sair: apaga os cookies de sessão (o fc_dispositivo fica). */
export async function DELETE(req: Request) {
  const recusa = recusarOrigem(req);
  if (recusa) return recusa;
  await apagarSessao();
  return NextResponse.json(VISITANTE, { headers: SEM_CACHE });
}
