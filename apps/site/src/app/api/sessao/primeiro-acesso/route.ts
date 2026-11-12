import { NextResponse } from 'next/server';
import { autenticar, recusarOrigem, SEM_CACHE } from '@/lib/sessao/autenticar';
import { validarPrimeiroAcesso } from '@/lib/sessao/credenciais';

export const dynamic = 'force-dynamic';

/** Primeiro acesso ou "esqueci a senha": código da distribuidora + nova senha, e já entra. */
export async function POST(req: Request) {
  const recusa = recusarOrigem(req);
  if (recusa) return recusa;
  const dados = validarPrimeiroAcesso(await req.json().catch(() => null));
  if (!dados) {
    return NextResponse.json(
      { mensagem: 'Confira o CNPJ ou CPF, o código (4 a 12 caracteres) e a nova senha (mínimo de 6).' },
      { status: 400, headers: SEM_CACHE },
    );
  }
  return autenticar(req, '/auth/primeiro-acesso', dados);
}
