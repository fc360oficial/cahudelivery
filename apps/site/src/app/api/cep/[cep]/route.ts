import { NextResponse } from 'next/server';
import { cepExato, criarCacheCep } from '@/lib/cep/cep';
import { consultarCep, type ResultadoCep } from '@/lib/cep/consultar-cep';
import { criarLimite } from '@/lib/conta/limite-tentativas';
import { SEM_CACHE } from '@/lib/sessao/autenticar';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

const DEZ_MINUTOS = 10 * 60 * 1000;
/** 30 consultas por IP do visitante a cada 10 minutos: o cadastro usa uma ou duas. */
const consultas = criarLimite({ maximo: 30, janelaMs: DEZ_MINUTOS });
/** CEP já consultado (encontrado ou inexistente) é respondido daqui por 10 minutos. */
const cache = criarCacheCep<ResultadoCep>({ validadeMs: DEZ_MINUTOS, maximoDeEntradas: 1000 });

const json = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: SEM_CACHE });

/**
 * Busca de CEP para o visitante (cadastro de cliente novo). Mesma consulta da rota da conta
 * (consultarCep), mas pública: para não virar proxy aberto, o CEP tem que ser exatamente 8
 * dígitos, cada IP tem limite de consultas e o resultado fica num cache curto por CEP.
 */
export async function GET(req: Request, { params }: { params: Promise<{ cep: string }> }) {
  const cep = cepExato((await params).cep);
  if (!cep) return json({ mensagem: 'CEP inválido.' }, 400);

  const agora = Date.now();
  const chave = ipDoVisitante(req.headers) ?? 'sem-ip';
  if (consultas.bloqueado(chave, agora)) {
    return json({ mensagem: 'Muitas consultas de CEP. Aguarde alguns minutos ou preencha o endereço à mão.' }, 429);
  }
  consultas.registrarFalha(chave, agora);

  let resultado = cache.ler(cep, agora);
  if (!resultado) {
    resultado = await consultarCep(cep);
    if (resultado.tipo === 'encontrado' || resultado.tipo === 'nao-encontrado') cache.gravar(cep, resultado, Date.now());
  }
  switch (resultado.tipo) {
    case 'encontrado': return json(resultado.endereco);
    case 'nao-encontrado': return json({ mensagem: 'CEP não encontrado.' }, 404);
    case 'invalido': return json({ mensagem: 'CEP inválido.' }, 400);
    default: return json({ mensagem: 'Não foi possível buscar o CEP agora. Preencha o endereço à mão.' }, 503);
  }
}
