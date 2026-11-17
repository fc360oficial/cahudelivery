import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { PoolClient } from 'pg';
import { PASTA_PRIVADA } from '../admin/admin-entregas.controller';
import { tenantCtx } from '../tenancy/tenant-context';
import type { EntregaPendente } from './notas-a-entregar.service';
import { kmEntre } from './rota-otimizada';

/** Acima disso o toque em "Cheguei" foi longe do endereço. Folga larga: o ponto do cliente hoje vem do CEP. */
export const DISTANCIA_ALERTA_M = 1500;

export const MOTIVOS_NAO_ENTREGA = ['cliente_fechado', 'sem_recebedor', 'recusou', 'endereco_nao_encontrado', 'outro'] as const;
export type MotivoNaoEntrega = (typeof MOTIVOS_NAO_ENTREGA)[number];
export const TIPOS_OCORRENCIA = ['avaria', 'falta', 'troca', 'recusa_item'] as const;
export type TipoOcorrencia = (typeof TIPOS_OCORRENCIA)[number];

const ROTULO_MOTIVO: Record<MotivoNaoEntrega, string> = {
  cliente_fechado: 'cliente fechado',
  sem_recebedor: 'ninguém para receber',
  recusou: 'cliente recusou',
  endereco_nao_encontrado: 'endereço não encontrado',
  outro: 'outro motivo',
};

export interface Ponto { em?: string; lat?: number; lng?: number }
export interface Foto { buffer: Buffer; originalname: string }

export interface ItemParada { notaNumero: string | null; codigo: string | null; descricao: string; quantidade: number }
export interface Parada {
  ordem: number;
  linhaIds: string[];
  cliente: string;
  telefone: string | null;
  endereco: EntregaPendente['endereco'];
  latitude: number | null;
  longitude: number | null;
  notas: Array<{ numero: string | null; origem: string; pedidoNumero: string | null; volumes: number }>;
  volumes: number;
  pesoKg: number;
  /** pendente → (chegou) → entregue | nao_entregue; "parcial" se as notas da parada tiveram destinos diferentes. */
  status: 'pendente' | 'no_cliente' | 'entregue' | 'nao_entregue' | 'parcial';
  chegadaEm: string | null;
  concluidaEm: string | null;
  ocorrencias: number;
  itens: ItemParada[];
}
export interface CargaMotorista {
  id: string; numero: number; data: string; status: string; saidaEm: string | null;
  caminhao: { nome: string; placa: string | null } | null;
  paradas: Parada[];
  totais: { paradas: number; feitas: number; volumes: number; pesoKg: number };
}

interface Linha {
  id: string; carga_id: string; ordem: number; status: string; pedido_id: string | null; nota_entrega_id: string | null;
  dados_json: EntregaPendente; volumes: string; peso_kg: string | null; chegada_em: Date | null; concluida_em: Date | null;
  foto_assinatura: string | null; ocorrencias: number;
}

const EXTENSOES = ['.png', '.jpg', '.jpeg', '.webp', '.heic'];
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const chaveParada = (d: EntregaPendente) =>
  [d.cliente, d.endereco.logradouro, d.endereco.numero, d.endereco.bairro].map((v) => (v ?? '').trim().toUpperCase()).join('|');

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/** Hora informada pelo celular (o registro pode subir horas depois, sem sinal); inválida ou no futuro vira agora. */
export function horaDoCelular(em: string | undefined, agora = new Date()): Date {
  const d = em ? new Date(em) : null;
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > agora.getTime() + 5 * 60_000) return agora;
  return d;
}

/** Agrupa as linhas seguidas do mesmo cliente no mesmo endereço numa parada (igual ao romaneio). */
export function agruparParadas(linhas: Array<Pick<Linha, 'id' | 'dados_json'>>): string[][] {
  const grupos: string[][] = [];
  let anterior = '';
  for (const l of linhas) {
    const k = chaveParada(l.dados_json);
    if (k === anterior && grupos.length) grupos[grupos.length - 1].push(l.id);
    else grupos.push([l.id]);
    anterior = k;
  }
  return grupos;
}

/**
 * O que o aplicativo do motorista faz com a carga autorizada. Toda ação traz a hora do celular e pode chegar
 * repetida (fila sem sinal): repetir não duplica nem muda o que já foi registrado.
 * Pedido do Fluxo Commerce acompanha: SAIU_ENTREGA na saída, ENTREGUE na entrega, volta a FATURADO se não entregou.
 */
@Injectable()
export class MotoristaService {
  private readonly log = new Logger('MotoristaService');

  /** A carga em rota do motorista ou, sem ela, a próxima autorizada. */
  async cargaAtual(motoristaId: string): Promise<{ carga: CargaMotorista | null }> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select c.id, c.numero, to_char(c.data_entrega, 'YYYY-MM-DD') as data, c.status, c.saida_em, k.nome as caminhao_nome, k.placa
         from cargas c left join caminhoes k on k.id = c.caminhao_id
        where c.motorista_id = $1 and c.status in ('autorizada','em_rota')
        order by (c.status = 'em_rota') desc, c.data_entrega, c.numero
        limit 1`,
      [motoristaId],
    );
    if (!rows[0]) return { carga: null };
    const c = rows[0];
    const linhas = await this.linhas(c.id);
    const itens = await this.itensDasLinhas(linhas);
    const paradas: Parada[] = agruparParadas(linhas).map((ids, i) => {
      const doGrupo = ids.map((id) => linhas.find((l) => l.id === id)!);
      const d = doGrupo[0].dados_json;
      const estados = new Set(doGrupo.map((l) => l.status));
      const status: Parada['status'] = estados.size > 1 && !estados.has('pendente') ? 'parcial'
        : estados.has('pendente') ? (doGrupo.some((l) => l.chegada_em) ? 'no_cliente' : 'pendente')
        : (doGrupo[0].status as 'entregue' | 'nao_entregue');
      const chegadas = doGrupo.map((l) => l.chegada_em).filter((x): x is Date => !!x);
      const conclusoes = doGrupo.map((l) => l.concluida_em).filter((x): x is Date => !!x);
      return {
        ordem: i + 1,
        linhaIds: ids,
        cliente: d.cliente,
        telefone: d.telefone,
        endereco: d.endereco,
        latitude: d.latitude,
        longitude: d.longitude,
        notas: doGrupo.map((l) => ({ numero: l.dados_json.nota?.numero ?? null, origem: l.dados_json.origem, pedidoNumero: l.dados_json.pedidoNumero, volumes: Number(l.volumes) })),
        volumes: doGrupo.reduce((s, l) => s + Number(l.volumes), 0),
        pesoKg: Math.round(doGrupo.reduce((s, l) => s + Number(l.peso_kg ?? 0), 0) * 10) / 10,
        status,
        chegadaEm: chegadas.length ? iso(new Date(Math.min(...chegadas.map((x) => new Date(x).getTime())))) : null,
        concluidaEm: conclusoes.length === doGrupo.length ? iso(new Date(Math.max(...conclusoes.map((x) => new Date(x).getTime())))) : null,
        ocorrencias: doGrupo.reduce((s, l) => s + Number(l.ocorrencias), 0),
        itens: doGrupo.flatMap((l) => itens.get(l.id) ?? []),
      };
    });
    return {
      carga: {
        id: c.id, numero: Number(c.numero), data: c.data, status: c.status, saidaEm: iso(c.saida_em),
        caminhao: c.caminhao_nome ? { nome: c.caminhao_nome, placa: c.placa } : null,
        paradas,
        totais: {
          paradas: paradas.length,
          feitas: paradas.filter((p) => p.status === 'entregue' || p.status === 'nao_entregue' || p.status === 'parcial').length,
          volumes: paradas.reduce((s, p) => s + p.volumes, 0),
          pesoKg: Math.round(paradas.reduce((s, p) => s + p.pesoKg, 0) * 10) / 10,
        },
      },
    };
  }

  /** Saída do CD. Autorizada vira em rota; os pedidos do Fluxo Commerce passam para "Saiu para entrega". */
  async iniciar(motoristaId: string, cargaId: string, em?: string): Promise<{ ok: true }> {
    await this.naTransacao(async (db) => {
      const carga = await this.cargaDoMotorista(db, motoristaId, cargaId);
      await this.garantirEmRota(db, carga, horaDoCelular(em));
    });
    return { ok: true };
  }

  /** "Cheguei no cliente": guarda a primeira chegada, o GPS e a distância do ponto do cadastro. */
  async chegada(motoristaId: string, cargaId: string, linhaIds: string[], p: Ponto): Promise<{ distanciaM: number | null; longe: boolean }> {
    let distancia: number | null = null;
    await this.naTransacao(async (db) => {
      const carga = await this.cargaDoMotorista(db, motoristaId, cargaId);
      await this.garantirEmRota(db, carga, horaDoCelular(p.em));
      const linhas = await this.linhasDaParada(db, cargaId, linhaIds);
      const destino = linhas[0].dados_json;
      if (p.lat !== undefined && p.lng !== undefined && destino.latitude !== null && destino.longitude !== null) {
        distancia = distanciaM({ lat: p.lat, lng: p.lng }, { lat: Number(destino.latitude), lng: Number(destino.longitude) });
      }
      await db.query(
        `update carga_entregas set chegada_em = $2, chegada_lat = $3, chegada_lng = $4, chegada_distancia_m = $5
          where id = any($1::uuid[]) and chegada_em is null and status = 'pendente'`,
        [linhaIds, horaDoCelular(p.em), p.lat ?? null, p.lng ?? null, distancia],
      );
    });
    return { distanciaM: distancia, longe: distancia !== null && distancia > DISTANCIA_ALERTA_M };
  }

  /** Entregue com a foto da linha assinada no romaneio (ou do canhoto). */
  async entregue(
    motoristaId: string, cargaId: string, linhaIds: string[],
    dados: Ponto & { recebedorNome: string; recebedorDocumento?: string; observacao?: string },
    fotos: { assinatura?: Foto; mercadoria?: Foto },
  ): Promise<{ ok: true }> {
    const { tenant } = tenantCtx();
    await this.naTransacao(async (db) => {
      const carga = await this.cargaDoMotorista(db, motoristaId, cargaId);
      const em = horaDoCelular(dados.em);
      await this.garantirEmRota(db, carga, em);
      const linhas = await this.linhasDaParada(db, cargaId, linhaIds);
      const abertas = linhas.filter((l) => l.status === 'pendente');
      if (linhas.some((l) => l.status === 'nao_entregue')) throw new ConflictException('Esta parada já foi registrada como não entregue.');
      if (!abertas.length) return; // reenvio: já está entregue
      if (!fotos.assinatura) throw new BadRequestException('A foto da assinatura é obrigatória.');
      const assinatura = this.gravarFoto(tenant.slug, abertas[0].id, 'canhoto', fotos.assinatura);
      const mercadoria = fotos.mercadoria ? this.gravarFoto(tenant.slug, abertas[0].id, 'foto', fotos.mercadoria) : null;
      const nome = dados.recebedorNome.trim();
      const documento = dados.recebedorDocumento?.trim() || null;
      await db.query(
        `update carga_entregas set status = 'entregue', viva = true, concluida_em = $2, concluida_lat = $3, concluida_lng = $4,
                chegada_em = coalesce(chegada_em, $2), recebedor_nome = $5, recebedor_documento = $6,
                foto_assinatura = $7, foto_mercadoria = $8, observacao = $9
          where id = any($1::uuid[]) and status = 'pendente'`,
        [abertas.map((l) => l.id), em, dados.lat ?? null, dados.lng ?? null, nome, documento, assinatura, mercadoria, dados.observacao?.trim() || null],
      );
      for (const l of abertas) {
        if (l.pedido_id) {
          // O mesmo comprovante aparece na tela do pedido no Delivery.
          await db.query(
            `insert into pedido_entregas (pedido_id, recebedor_nome, recebedor_documento, foto_canhoto, foto_entrega, latitude, longitude, observacao, entregue_em)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (pedido_id) do nothing`,
            [l.pedido_id, nome, documento, assinatura, mercadoria, dados.lat ?? null, dados.lng ?? null, 'Fluxo Entregas', em],
          );
          const up = await db.query(`update pedidos set status = 'ENTREGUE' where id = $1 and status in ('FATURADO','SAIU_ENTREGA')`, [l.pedido_id]);
          if (up.rowCount) {
            await db.query(`insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'ENTREGUE',$2,'sistema')`, [l.pedido_id, `Entregue, recebido por ${nome}`]);
          }
        } else if (l.nota_entrega_id) {
          await db.query(`update notas_entrega set status = 'ENTREGUE', atualizada_em = now() where id = $1 and status = 'FATURADO'`, [l.nota_entrega_id]);
        }
      }
    });
    if (dados.lat !== undefined && dados.lng !== undefined && dados.lat !== null && dados.lng !== null) {
      // Melhora o mapa sem nunca atrapalhar a entrega: se falhar, só registra.
      await this.aprenderPonto(linhaIds, Number(dados.lat), Number(dados.lng)).catch((e) => this.log.warn(`aprenderPonto: ${(e as Error).message}`));
    }
    return { ok: true };
  }

  /**
   * O GPS do celular na entrega vira o ponto do cliente quando o cadastro só tinha o ponto aproximado do CEP
   * (ou nenhum). Assim a rota da próxima carga sai certa. Não mexe em ponto achado pela rua, e ignora GPS a mais
   * de 3 km do ponto atual (entrega feita em outro lugar).
   */
  private async aprenderPonto(linhaIds: string[], lat: number, lng: number): Promise<void> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select e.id, e.latitude, e.longitude, e.geo_precisao
         from carga_entregas ce
         left join pedidos p on p.id = ce.pedido_id
         left join notas_entrega ne on ne.id = ce.nota_entrega_id
         join cliente_enderecos e on
              (p.id is not null and e.id = case when p.endereco_snapshot_json->>'id' ~ '^[0-9a-fA-F-]{36}$' then (p.endereco_snapshot_json->>'id')::uuid end)
           or (ne.id is not null and e.cliente_id = ne.cliente_id and e.padrao
               and regexp_replace(coalesce(e.cep, ''), '\\D', '', 'g') <> ''
               and regexp_replace(coalesce(e.cep, ''), '\\D', '', 'g') = regexp_replace(coalesce(ne.destinatario_json->'endereco'->>'cep', ''), '\\D', '', 'g'))
        where ce.id = any($1::uuid[])`,
      [linhaIds],
    );
    for (const e of rows) {
      if (e.geo_precisao === 'endereco' && e.latitude !== null) continue;
      if (e.latitude !== null && e.longitude !== null && kmEntre([Number(e.latitude), Number(e.longitude)], [lat, lng]) > 3) continue;
      await pool.query(
        `update cliente_enderecos set latitude = $2, longitude = $3, geo_precisao = 'endereco' where id = $1`,
        [e.id, lat.toFixed(6), lng.toFixed(6)],
      );
    }
  }

  /** Não entregue: a mercadoria volta com o motorista e a nota fica livre para outra carga. */
  async naoEntregue(
    motoristaId: string, cargaId: string, linhaIds: string[],
    dados: Ponto & { motivo: MotivoNaoEntrega; observacao?: string }, foto?: Foto,
  ): Promise<{ ok: true }> {
    const { tenant } = tenantCtx();
    if (dados.motivo === 'outro' && !dados.observacao?.trim()) throw new BadRequestException('Escreva o que aconteceu.');
    await this.naTransacao(async (db) => {
      const carga = await this.cargaDoMotorista(db, motoristaId, cargaId);
      const em = horaDoCelular(dados.em);
      await this.garantirEmRota(db, carga, em);
      const linhas = await this.linhasDaParada(db, cargaId, linhaIds);
      if (linhas.some((l) => l.status === 'entregue')) throw new ConflictException('Esta parada já foi registrada como entregue.');
      const abertas = linhas.filter((l) => l.status === 'pendente');
      if (!abertas.length) return;
      const local = foto ? this.gravarFoto(tenant.slug, abertas[0].id, 'local', foto) : null;
      // viva = false: a nota sai desta carga e volta para "Fora das cargas", para o gerente decidir.
      await db.query(
        `update carga_entregas set status = 'nao_entregue', viva = false, concluida_em = $2, concluida_lat = $3, concluida_lng = $4,
                chegada_em = coalesce(chegada_em, $2), motivo_nao_entrega = $5, observacao = $6, foto_local = $7
          where id = any($1::uuid[]) and status = 'pendente'`,
        [abertas.map((l) => l.id), em, dados.lat ?? null, dados.lng ?? null, dados.motivo, dados.observacao?.trim() || null, local],
      );
      for (const l of abertas.filter((x) => x.pedido_id)) {
        const up = await db.query(`update pedidos set status = 'FATURADO' where id = $1 and status = 'SAIU_ENTREGA'`, [l.pedido_id]);
        if (up.rowCount) {
          await db.query(`insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'FATURADO',$2,'sistema')`, [l.pedido_id, `Não entregue: ${ROTULO_MOTIVO[dados.motivo]}`]);
        }
      }
    });
    return { ok: true };
  }

  /** Ocorrência numa nota da parada (avaria exige foto). O id vem do celular: repetir não duplica. */
  async ocorrencia(
    motoristaId: string, cargaId: string,
    dados: { id: string; linhaId: string; tipo: TipoOcorrencia; produtoCodigo?: string; produtoDescricao?: string; quantidade?: number; observacao?: string; em?: string },
    foto?: Foto,
  ): Promise<{ ok: true }> {
    const { pool, tenant } = tenantCtx();
    await this.cargaDoMotorista(pool, motoristaId, cargaId, ['em_rota', 'encerrada']);
    await this.linhasDaParada(pool, cargaId, [dados.linhaId]);
    const ja = await pool.query(`select 1 from carga_ocorrencias where id = $1`, [dados.id]);
    if (ja.rowCount) return { ok: true };
    if (dados.tipo === 'avaria' && !foto) throw new BadRequestException('A foto da avaria é obrigatória.');
    const arquivo = foto ? this.gravarFoto(tenant.slug, dados.linhaId, 'ocorrencia', foto) : null;
    await pool.query(
      `insert into carga_ocorrencias (id, carga_entrega_id, tipo, produto_codigo, produto_descricao, quantidade, foto, observacao, registrada_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
      [dados.id, dados.linhaId, dados.tipo, dados.produtoCodigo?.trim() || null, dados.produtoDescricao?.trim() || null,
        dados.quantidade ?? null, arquivo, dados.observacao?.trim() || null, horaDoCelular(dados.em)],
    );
    return { ok: true };
  }

  /** Posições do celular. Só valem com carga em rota; o mesmo ponto reenviado não duplica. */
  async posicoes(motoristaId: string, pontos: Array<{ lat: number; lng: number; precisaoM?: number; em: string }>): Promise<{ aceitos: number }> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(`select id from cargas where motorista_id = $1 and status = 'em_rota' order by saida_em desc nulls last limit 1`, [motoristaId]);
    if (!rows[0] || !pontos.length) return { aceitos: 0 };
    const validos = pontos.map((p) => ({ ...p, quando: horaDoCelular(p.em) }));
    const { rowCount } = await pool.query(
      `insert into motorista_posicoes (motorista_id, carga_id, lat, lng, precisao_m, registrada_em)
       select $1, $2, x.lat, x.lng, x.precisao, x.em
         from unnest($3::numeric[], $4::numeric[], $5::int[], $6::timestamptz[]) as x(lat, lng, precisao, em)
       on conflict (motorista_id, registrada_em) do nothing`,
      [motoristaId, rows[0].id, validos.map((p) => p.lat), validos.map((p) => p.lng), validos.map((p) => (p.precisaoM === undefined ? null : Math.round(p.precisaoM))), validos.map((p) => p.quando)],
    );
    return { aceitos: rowCount ?? 0 };
  }

  /** Volta ao CD: só com todas as paradas resolvidas. */
  async encerrar(motoristaId: string, cargaId: string, em?: string): Promise<{ ok: true }> {
    await this.naTransacao(async (db) => {
      const carga = await this.cargaDoMotorista(db, motoristaId, cargaId, ['em_rota', 'encerrada']);
      if (carga.status === 'encerrada') return;
      const pendentes = await db.query(`select count(*)::int as n from carga_entregas where carga_id = $1 and status = 'pendente'`, [cargaId]);
      if (pendentes.rows[0].n > 0) throw new BadRequestException(`Ainda faltam ${pendentes.rows[0].n} entrega(s) para registrar.`);
      await db.query(`update cargas set status = 'encerrada', retorno_em = $2, atualizada_em = now() where id = $1 and status = 'em_rota'`, [cargaId, horaDoCelular(em)]);
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------

  private async naTransacao(fn: (db: PoolClient) => Promise<void>): Promise<void> {
    const { pool } = tenantCtx();
    const db = await pool.connect();
    try {
      await db.query('begin');
      await fn(db);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback').catch(() => {});
      throw e;
    } finally {
      db.release();
    }
  }

  private async cargaDoMotorista(
    db: Pick<PoolClient, 'query'>, motoristaId: string, cargaId: string, aceitas: string[] = ['autorizada', 'em_rota'],
  ): Promise<{ id: string; status: string }> {
    const { rows } = await db.query(`select id, status, motorista_id from cargas where id = $1 for update`, [cargaId]);
    const c = rows[0];
    if (!c) throw new NotFoundException('Carga não encontrada');
    if (c.motorista_id !== motoristaId) throw new ForbiddenException('Esta carga é de outro motorista.');
    if (!aceitas.includes(c.status)) {
      throw new ConflictException(c.status === 'rascunho' ? 'O CD reabriu esta carga para ajuste. Aguarde a nova autorização.' : 'Esta carga já foi encerrada.');
    }
    return { id: c.id, status: c.status };
  }

  private async garantirEmRota(db: Pick<PoolClient, 'query'>, carga: { id: string; status: string }, em: Date): Promise<void> {
    if (carga.status !== 'autorizada') return;
    await db.query(`update cargas set status = 'em_rota', saida_em = $2, atualizada_em = now() where id = $1 and status = 'autorizada'`, [carga.id, em]);
    carga.status = 'em_rota';
    const pedidos = await db.query(
      `update pedidos p set status = 'SAIU_ENTREGA'
         from carga_entregas ce
        where ce.carga_id = $1 and ce.pedido_id = p.id and ce.status = 'pendente' and p.status = 'FATURADO'
        returning p.id`,
      [carga.id],
    );
    for (const p of pedidos.rows) {
      await db.query(`insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'SAIU_ENTREGA','Saiu para entrega','sistema')`, [p.id]);
    }
  }

  private async linhasDaParada(db: Pick<PoolClient, 'query'>, cargaId: string, linhaIds: string[]): Promise<Linha[]> {
    if (!linhaIds.length) throw new BadRequestException('Informe a parada.');
    const { rows } = await db.query(
      `select id, carga_id, ordem, status, pedido_id, nota_entrega_id, dados_json, volumes, peso_kg, chegada_em, concluida_em, foto_assinatura, 0 as ocorrencias
         from carga_entregas where carga_id = $1 and id = any($2::uuid[])
        order by ordem`,
      [cargaId, linhaIds],
    );
    if (rows.length !== new Set(linhaIds).size) throw new NotFoundException('Parada não encontrada nesta carga.');
    return rows as Linha[];
  }

  private async linhas(cargaId: string): Promise<Linha[]> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select ce.id, ce.carga_id, ce.ordem, ce.status, ce.pedido_id, ce.nota_entrega_id, ce.dados_json, ce.volumes, ce.peso_kg,
              ce.chegada_em, ce.concluida_em, ce.foto_assinatura,
              (select count(*)::int from carga_ocorrencias o where o.carga_entrega_id = ce.id) as ocorrencias
         from carga_entregas ce where ce.carga_id = $1
        order by ce.ordem, ce.criada_em`,
      [cargaId],
    );
    return rows as Linha[];
  }

  /** Itens de cada nota, para o motorista escolher o produto da ocorrência. */
  private async itensDasLinhas(linhas: Linha[]): Promise<Map<string, ItemParada[]>> {
    const { pool } = tenantCtx();
    const out = new Map<string, ItemParada[]>();
    const pedidos = linhas.filter((l) => l.pedido_id).map((l) => l.pedido_id!);
    const notas = linhas.filter((l) => l.nota_entrega_id).map((l) => l.nota_entrega_id!);
    const [faturados, doPedido, dasNotas] = await Promise.all([
      pedidos.length ? pool.query(`select pedido_id, itens_json from pedido_faturamentos where pedido_id = any($1::uuid[])`, [pedidos]) : { rows: [] },
      pedidos.length
        ? pool.query(
          `select i.pedido_id, coalesce(pr.erp_produto_id, pr.sku) as codigo, i.descricao_snapshot as descricao, i.quantidade
             from pedido_itens i left join produtos pr on pr.id = i.produto_id where i.pedido_id = any($1::uuid[])`,
          [pedidos],
        )
        : { rows: [] },
      notas.length ? pool.query(`select id, itens_json from notas_entrega where id = any($1::uuid[])`, [notas]) : { rows: [] },
    ]);
    const codigos = [...new Set(faturados.rows.flatMap((f) => (Array.isArray(f.itens_json) ? f.itens_json : []).map((i: Record<string, unknown>) => String(i.produto_codigo ?? ''))).filter(Boolean))];
    const nomes = new Map<string, string>();
    if (codigos.length) {
      const pr = await pool.query(`select coalesce(erp_produto_id, sku) as codigo, sku, erp_produto_id, nome from produtos where erp_produto_id = any($1::text[]) or sku = any($1::text[])`, [codigos]);
      for (const p of pr.rows) {
        if (p.sku) nomes.set(p.sku, p.nome);
        if (p.erp_produto_id) nomes.set(p.erp_produto_id, p.nome);
      }
    }
    for (const l of linhas) {
      const nota = l.dados_json.nota?.numero ?? null;
      let itens: ItemParada[] = [];
      if (l.pedido_id) {
        const fat = faturados.rows.find((f) => f.pedido_id === l.pedido_id);
        const lista = fat && Array.isArray(fat.itens_json) ? (fat.itens_json as Array<Record<string, unknown>>) : [];
        itens = lista.length
          ? lista.map((i) => ({ notaNumero: nota, codigo: String(i.produto_codigo ?? '') || null, descricao: nomes.get(String(i.produto_codigo ?? '')) ?? `Produto ${i.produto_codigo}`, quantidade: Number(i.quantidade) }))
          : doPedido.rows.filter((i) => i.pedido_id === l.pedido_id).map((i) => ({ notaNumero: nota, codigo: i.codigo ?? null, descricao: i.descricao, quantidade: Number(i.quantidade) }));
      } else {
        const n = dasNotas.rows.find((x) => x.id === l.nota_entrega_id);
        const lista = n && Array.isArray(n.itens_json) ? (n.itens_json as Array<Record<string, unknown>>) : [];
        itens = lista.map((i) => ({ notaNumero: nota, codigo: i.codigo ? String(i.codigo) : null, descricao: String(i.descricao ?? ''), quantidade: Number(i.quantidade) }));
      }
      out.set(l.id, itens);
    }
    return out;
  }

  /** Grava a foto fora do público (uploads-privado), com nome que a tela do pedido do Delivery já sabe abrir. */
  private gravarFoto(slug: string, linhaId: string, tipo: 'canhoto' | 'foto' | 'local' | 'ocorrencia', f: Foto): string {
    const pasta = join(PASTA_PRIVADA, slug.toLowerCase(), 'entregas');
    if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
    const ext = EXTENSOES.includes(extname(f.originalname).toLowerCase()) ? extname(f.originalname).toLowerCase() : '.jpg';
    const nome = `${linhaId}-${tipo}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`;
    const tmp = join(pasta, `${nome}.tmp`);
    writeFileSync(tmp, f.buffer);
    renameSync(tmp, join(pasta, nome));
    return nome;
  }
}
