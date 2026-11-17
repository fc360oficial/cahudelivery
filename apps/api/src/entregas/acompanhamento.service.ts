import { Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { DISTANCIA_ALERTA_M } from './motorista.service';
import type { EntregaPendente } from './notas-a-entregar.service';
import { lerCd } from './cd-entregas';

/** Sem posição nova há mais que isso, com a carga em rota, vira alerta. */
export const SEM_SINAL_MIN = 10;

export interface OcorrenciaAcomp {
  id: string;
  tipo: 'avaria' | 'falta' | 'troca' | 'recusa_item';
  produtoCodigo: string | null;
  produtoDescricao: string | null;
  quantidade: number | null;
  observacao: string | null;
  foto: string | null;
  registradaEm: string;
  resolvidaEm: string | null;
  resolucao: string | null;
}

export interface ParadaAcomp {
  id: string;
  /** pedido:<uuid> ou nota:<uuid>, para abrir o detalhe da entrega. */
  entregaId: string;
  ordem: number;
  status: 'pendente' | 'no_cliente' | 'entregue' | 'nao_entregue';
  cliente: string;
  bairro: string | null;
  cidade: string | null;
  endereco: string;
  latitude: number | null;
  longitude: number | null;
  nota: string | null;
  origem: string;
  volumes: number;
  chegadaEm: string | null;
  chegadaDistanciaM: number | null;
  concluidaEm: string | null;
  /** Minutos entre a saída do cliente anterior (ou do CD) e a chegada neste. */
  trajetoMin: number | null;
  /** Minutos entre a chegada e a conclusão. */
  noClienteMin: number | null;
  recebedorNome: string | null;
  recebedorDocumento: string | null;
  motivoNaoEntrega: string | null;
  observacao: string | null;
  fotos: { assinatura: string | null; mercadoria: string | null; local: string | null };
  ocorrencias: OcorrenciaAcomp[];
}

export interface CargaAcomp {
  id: string;
  numero: number;
  status: 'autorizada' | 'em_rota' | 'encerrada';
  caminhao: { nome: string; placa: string | null } | null;
  motorista: { nome: string; telefone: string | null } | null;
  saidaEm: string | null;
  retornoEm: string | null;
  ultimaPosicao: { lat: number; lng: number; em: string; precisaoM: number | null } | null;
  /** Minutos sem posição nova (só em rota). */
  semSinalMin: number | null;
  trajeto: Array<[number, number]>;
  paradas: ParadaAcomp[];
}

export interface AlertaAcomp {
  tipo: 'sem_sinal' | 'chegada_longe' | 'nao_entregue' | 'ocorrencia';
  cargaId: string;
  paradaId: string | null;
  ocorrenciaId: string | null;
  em: string;
  texto: string;
}

export interface Acompanhamento {
  data: string;
  agora: string;
  /** Ponto do CD (saída e volta das rotas); null = não cadastrado. */
  cd: { latitude: number; longitude: number } | null;
  resumo: { emRota: number; encerradas: number; aguardandoSaida: number; paradas: number; entregues: number; naoEntregues: number; noCliente: number; tempoMedioNoClienteMin: number | null };
  alertas: AlertaAcomp[];
  cargas: CargaAcomp[];
}

const MOTIVOS: Record<string, string> = {
  cliente_fechado: 'cliente fechado',
  sem_recebedor: 'sem ninguém para receber',
  recusou: 'cliente recusou',
  endereco_nao_encontrado: 'endereço não encontrado',
  outro: 'outro motivo',
};
const TIPOS_OCORRENCIA: Record<string, string> = { avaria: 'Avaria', falta: 'Falta', troca: 'Troca', recusa_item: 'Item recusado' };

const minutos = (de: Date | null, ate: Date | null) => (de && ate ? Math.max(0, Math.round((ate.getTime() - de.getTime()) / 60000)) : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Fotos que a retaguarda pode abrir: só nomes gerados pelo app do motorista. */
export const RE_FOTO_ENTREGA = /^[0-9a-f-]{36}-(canhoto|foto|local|ocorrencia)-[a-z0-9]+-[0-9a-f]{8}\.(png|jpg|jpeg|webp|heic)$/;

@Injectable()
export class AcompanhamentoService {
  /** Cargas que já saíram ou vão sair no dia: onde está cada caminhão, tempos por cliente, comprovantes e alertas. */
  async doDia(data: string, agora = new Date()): Promise<Acompanhamento> {
    const { pool } = tenantCtx();
    const cargas = await pool.query(
      `select c.id, c.numero, c.status, c.saida_em, c.retorno_em,
              k.nome as caminhao_nome, k.placa, m.nome as motorista_nome, m.telefone as motorista_telefone
         from cargas c
         left join caminhoes k on k.id = c.caminhao_id
         left join motoristas m on m.id = c.motorista_id
        where c.data_entrega = $1 and c.status in ('autorizada','em_rota','encerrada')
        order by (c.status = 'em_rota') desc, (c.status = 'autorizada') desc, c.numero`,
      [data],
    );
    const ids = cargas.rows.map((c) => c.id as string);
    const [linhas, ocorrencias, posicoes] = ids.length
      ? await Promise.all([
          pool.query(
            `select id, carga_id, ordem, dados_json, volumes, status, viva, chegada_em, chegada_distancia_m, concluida_em,
                    recebedor_nome, recebedor_documento, foto_assinatura, foto_mercadoria, foto_local, motivo_nao_entrega, observacao
               from carga_entregas where carga_id = any($1::uuid[]) and (viva or status <> 'pendente')
              order by carga_id, ordem`,
            [ids],
          ),
          pool.query(
            `select o.id, o.carga_entrega_id, o.tipo, o.produto_codigo, o.produto_descricao, o.quantidade, o.foto, o.observacao,
                    o.registrada_em, o.resolvida_em, o.resolucao
               from carga_ocorrencias o join carga_entregas e on e.id = o.carga_entrega_id
              where e.carga_id = any($1::uuid[]) order by o.registrada_em`,
            [ids],
          ),
          pool.query(
            `select carga_id, lat, lng, precisao_m, registrada_em from motorista_posicoes
              where carga_id = any($1::uuid[]) order by carga_id, registrada_em`,
            [ids],
          ),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }];

    const alertas: AlertaAcomp[] = [];
    const saida: CargaAcomp[] = cargas.rows.map((c) => {
      const pontos = posicoes.rows.filter((p) => p.carga_id === c.id);
      const ultimo = pontos[pontos.length - 1];
      const saidaEm = c.saida_em ? new Date(c.saida_em) : null;
      const carga: CargaAcomp = {
        id: c.id,
        numero: Number(c.numero),
        status: c.status,
        caminhao: c.caminhao_nome ? { nome: c.caminhao_nome, placa: c.placa } : null,
        motorista: c.motorista_nome ? { nome: c.motorista_nome, telefone: c.motorista_telefone } : null,
        saidaEm: iso(c.saida_em),
        retornoEm: iso(c.retorno_em),
        ultimaPosicao: ultimo ? { lat: Number(ultimo.lat), lng: Number(ultimo.lng), em: iso(ultimo.registrada_em)!, precisaoM: num(ultimo.precisao_m) } : null,
        semSinalMin: null,
        trajeto: pontos.map((p) => [Number(p.lat), Number(p.lng)]),
        paradas: [],
      };
      if (c.status === 'em_rota') {
        const referencia = ultimo ? new Date(ultimo.registrada_em) : saidaEm;
        const sem = minutos(referencia, agora);
        carga.semSinalMin = sem;
        if (sem !== null && sem > SEM_SINAL_MIN) {
          alertas.push({
            tipo: 'sem_sinal', cargaId: c.id, paradaId: null, ocorrenciaId: null, em: referencia!.toISOString(),
            texto: `${c.caminhao_nome ?? `Carga ${c.numero}`}${c.motorista_nome ? ` (${c.motorista_nome})` : ''} sem localização há ${sem} min`,
          });
        }
      }

      let anterior = saidaEm;
      for (const l of linhas.rows.filter((x) => x.carga_id === c.id)) {
        const d = l.dados_json as EntregaPendente;
        const chegada = l.chegada_em ? new Date(l.chegada_em) : null;
        const concluida = l.concluida_em ? new Date(l.concluida_em) : null;
        const status: ParadaAcomp['status'] = l.status !== 'pendente' ? l.status : chegada ? 'no_cliente' : 'pendente';
        const e = d.endereco ?? ({} as EntregaPendente['endereco']);
        const parada: ParadaAcomp = {
          id: l.id,
          entregaId: d.id,
          ordem: l.ordem,
          status,
          cliente: d.cliente,
          bairro: e.bairro ?? null,
          cidade: e.cidade ?? null,
          endereco: [e.logradouro, e.numero].filter(Boolean).join(', '),
          latitude: d.latitude ?? null,
          longitude: d.longitude ?? null,
          nota: d.nota?.numero ?? null,
          origem: d.origem,
          volumes: Number(l.volumes),
          chegadaEm: iso(l.chegada_em),
          chegadaDistanciaM: num(l.chegada_distancia_m),
          concluidaEm: iso(l.concluida_em),
          trajetoMin: chegada ? minutos(anterior, chegada) : null,
          noClienteMin: chegada ? minutos(chegada, concluida ?? (status === 'no_cliente' ? agora : null)) : null,
          recebedorNome: l.recebedor_nome,
          recebedorDocumento: l.recebedor_documento,
          motivoNaoEntrega: l.motivo_nao_entrega,
          observacao: l.observacao,
          fotos: { assinatura: l.foto_assinatura, mercadoria: l.foto_mercadoria, local: l.foto_local },
          ocorrencias: ocorrencias.rows.filter((o) => o.carga_entrega_id === l.id).map((o) => ({
            id: o.id, tipo: o.tipo, produtoCodigo: o.produto_codigo, produtoDescricao: o.produto_descricao, quantidade: num(o.quantidade),
            observacao: o.observacao, foto: o.foto, registradaEm: iso(o.registrada_em)!, resolvidaEm: iso(o.resolvida_em), resolucao: o.resolucao,
          })),
        };
        if (concluida) anterior = concluida;
        else if (chegada) anterior = chegada;
        carga.paradas.push(parada);

        if (parada.chegadaDistanciaM !== null && parada.chegadaDistanciaM > DISTANCIA_ALERTA_M) {
          alertas.push({
            tipo: 'chegada_longe', cargaId: c.id, paradaId: l.id, ocorrenciaId: null, em: parada.chegadaEm!,
            texto: `"Cheguei" em ${parada.cliente} marcado a ${(parada.chegadaDistanciaM / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km do endereço`,
          });
        }
        if (status === 'nao_entregue') {
          alertas.push({
            tipo: 'nao_entregue', cargaId: c.id, paradaId: l.id, ocorrenciaId: null, em: parada.concluidaEm ?? parada.chegadaEm ?? agora.toISOString(),
            texto: `${parada.cliente} não recebeu (${MOTIVOS[l.motivo_nao_entrega] ?? 'sem motivo'})${parada.nota ? `. Nota ${parada.nota} volta no caminhão` : ''}`,
          });
        }
        for (const o of parada.ocorrencias.filter((x) => !x.resolvidaEm)) {
          alertas.push({
            tipo: 'ocorrencia', cargaId: c.id, paradaId: l.id, ocorrenciaId: o.id, em: o.registradaEm,
            texto: `${TIPOS_OCORRENCIA[o.tipo]} em ${parada.cliente}: ${[o.quantidade !== null ? `${o.quantidade.toLocaleString('pt-BR')}x` : null, o.produtoDescricao, o.observacao].filter(Boolean).join(' · ')}`,
          });
        }
      }
      return carga;
    });

    const todas = saida.flatMap((c) => c.paradas);
    const feitas = todas.filter((p) => p.status === 'entregue' && p.noClienteMin !== null);
    alertas.sort((a, b) => b.em.localeCompare(a.em));
    const cd = await lerCd(pool);
    return {
      data,
      agora: agora.toISOString(),
      cd: cd ? { latitude: cd.latitude, longitude: cd.longitude } : null,
      resumo: {
        emRota: saida.filter((c) => c.status === 'em_rota').length,
        encerradas: saida.filter((c) => c.status === 'encerrada').length,
        aguardandoSaida: saida.filter((c) => c.status === 'autorizada').length,
        paradas: todas.length,
        entregues: todas.filter((p) => p.status === 'entregue').length,
        naoEntregues: todas.filter((p) => p.status === 'nao_entregue').length,
        noCliente: todas.filter((p) => p.status === 'no_cliente').length,
        tempoMedioNoClienteMin: feitas.length ? Math.round(feitas.reduce((s, p) => s + (p.noClienteMin ?? 0), 0) / feitas.length) : null,
      },
      alertas,
      cargas: saida,
    };
  }

  /** O gerente registra o que combinou com o cliente; nota, crédito e estoque continuam pelo Dlinks. */
  async resolverOcorrencia(id: string, resolucao: string, usuarioId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const r = await pool.query(
      `update carga_ocorrencias set resolvida_em = now(), resolvida_por = $2, resolucao = $3 where id = $1 and resolvida_em is null`,
      [id, usuarioId, resolucao],
    );
    if (!r.rowCount) throw new NotFoundException('Ocorrência não encontrada ou já resolvida');
    return { ok: true };
  }

  /** Confere que a foto pertence a uma entrega ou ocorrência deste banco antes de abrir o arquivo. */
  async fotoExiste(nome: string): Promise<boolean> {
    if (!RE_FOTO_ENTREGA.test(nome)) return false;
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `select 1 from carga_entregas where $1 in (foto_assinatura, foto_mercadoria, foto_local)
       union all select 1 from carga_ocorrencias where foto = $1 limit 1`,
      [nome],
    );
    return !!rowCount;
  }
}
