import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { tenantCtx } from '../tenancy/tenant-context';
import { NotasAEntregarService, type EntregaPendente } from './notas-a-entregar.service';
import { sugerirCargas, type MotivoFora } from './sugestao-carga';

export interface CargaEntrega {
  /** Linha da carga (para tirar e reordenar). */
  id: string;
  /** "pedido:<uuid>" ou "nota:<uuid>". */
  entregaId: string;
  ordem: number;
  status: string;
  dados: EntregaPendente;
  volumes: number;
  pesoKg: number | null;
  itensSemPeso: number;
}

export interface Carga {
  id: string;
  numero: number;
  data: string;
  status: string;
  sugerida: boolean;
  caminhao: { id: string; nome: string; placa: string | null; capacidadeKg: number | null } | null;
  motorista: { id: string; nome: string } | null;
  autorizadaEm: string | null;
  entregas: CargaEntrega[];
  volumes: number;
  pesoKg: number;
  entregasComPesoIncompleto: number;
}

export interface CaminhaoDoDia {
  id: string; nome: string; placa: string | null; capacidadeKg: number | null; regiao: string | null; situacao: string;
  motoristaId: string | null; motoristaNome: string | null;
  /** Já tem carga viva neste dia. */
  emUso: boolean;
}

export interface PainelCargas {
  data: string;
  cargas: Carga[];
  /** Faturado, de entrega, e em nenhuma carga viva (de qualquer dia). */
  fora: EntregaPendente[];
  caminhoes: CaminhaoDoDia[];
  motoristas: Array<{ id: string; nome: string }>;
  resumo: { entregas: number; emCargas: number; fora: number; pesoKg: number };
  /** Só depois de "sugerir": por que cada entrega ficou fora. */
  motivos?: Record<string, MotivoFora>;
}

type Executor = Pick<Pool | PoolClient, 'query'>;

const VIVAS = `('rascunho','autorizada','em_rota')`;
const RE_ENTREGA = /^(pedido|nota):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const arredondar = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas;
const numeroOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Data de hoje no calendário de Recife (o servidor pode estar em outro fuso). */
export function hojeEmRecife(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
}

/**
 * Montagem de carga. A carga nasce rascunho (sugerida ou feita à mão), o gerente do CD ajusta e autoriza;
 * só carga autorizada vai para o aplicativo do motorista. Nada aqui muda o status do pedido no ERP.
 */
@Injectable()
export class CargasService {
  constructor(private readonly notas: NotasAEntregarService) {}

  async painel(data: string): Promise<PainelCargas> {
    const { pool } = tenantCtx();
    const [cargas, pendentes, vivas, caminhoes, motoristas] = await Promise.all([
      this.cargasPor(pool, `c.data_entrega = $1 and c.status <> 'cancelada'`, [data]),
      this.notas.listar(),
      this.entregasVivas(pool),
      pool.query(
        `select c.id, c.nome, c.placa, c.capacidade_kg, c.regiao, c.situacao, c.motorista_id, m.nome as motorista_nome,
                exists (select 1 from cargas x where x.caminhao_id = c.id and x.data_entrega = $1 and x.status in ${VIVAS}) as em_uso
           from caminhoes c left join motoristas m on m.id = c.motorista_id
          where c.situacao <> 'inativo'
          order by c.nome`,
        [data],
      ),
      pool.query(`select id, nome from motoristas where ativo order by nome`),
    ]);
    const fora = pendentes.entregas.filter((e) => !vivas.has(e.id));
    const emCargas = cargas.reduce((s, c) => s + c.entregas.length, 0);
    return {
      data,
      cargas,
      fora,
      caminhoes: caminhoes.rows.map((c) => ({
        id: c.id, nome: c.nome, placa: c.placa, capacidadeKg: numeroOuNulo(c.capacidade_kg), regiao: c.regiao, situacao: c.situacao,
        motoristaId: c.motorista_id, motoristaNome: c.motorista_nome, emUso: c.em_uso === true,
      })),
      motoristas: motoristas.rows.map((m) => ({ id: m.id, nome: m.nome })),
      resumo: {
        entregas: emCargas + fora.length,
        emCargas,
        fora: fora.length,
        pesoKg: arredondar(cargas.reduce((s, c) => s + c.pesoKg, 0) + fora.reduce((s, e) => s + (e.pesoKg ?? 0), 0), 1),
      },
    };
  }

  /**
   * Refaz a sugestão do dia: apaga os rascunhos (carga autorizada ou em rota nunca é tocada) e distribui o
   * que está fora das cargas nos caminhões ativos que ainda não têm carga viva nesse dia.
   */
  async sugerir(data: string, usuarioId: string): Promise<PainelCargas> {
    const { pool } = tenantCtx();
    const pendentes = await this.notas.listar();
    const motivos: Record<string, MotivoFora> = {};
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from cargas where data_entrega = $1 and status = 'rascunho'`, [data]);
      const vivas = await this.entregasVivas(client);
      const livres = pendentes.entregas.filter((e) => !vivas.has(e.id));
      const caminhoes = await client.query(
        `select c.id, c.capacidade_kg, c.regiao, case when m.ativo then m.id end as motorista_id
           from caminhoes c left join motoristas m on m.id = c.motorista_id
          where c.situacao = 'ativo'
            and not exists (select 1 from cargas x where x.caminhao_id = c.id and x.data_entrega = $1 and x.status in ${VIVAS})
          order by c.nome`,
        [data],
      );
      const sugestao = sugerirCargas(
        livres.map((e) => ({ id: e.id, cidade: e.endereco.cidade, bairro: e.endereco.bairro, cliente: e.cliente, pesoKg: e.pesoKg })),
        caminhoes.rows.map((c) => ({ id: c.id, capacidadeKg: numeroOuNulo(c.capacidade_kg), regiao: c.regiao })),
      );
      const porId = new Map(livres.map((e) => [e.id, e]));
      for (const sug of sugestao.cargas) {
        const caminhao = caminhoes.rows.find((c) => c.id === sug.caminhaoId);
        const { rows } = await client.query(
          `insert into cargas (data_entrega, caminhao_id, motorista_id, sugerida, criada_por) values ($1,$2,$3,true,$4) returning id`,
          [data, sug.caminhaoId, caminhao?.motorista_id ?? null, usuarioId],
        );
        let ordem = 0;
        for (const entregaId of sug.entregaIds) await this.inserirEntrega(client, rows[0].id, porId.get(entregaId)!, ++ordem);
      }
      for (const f of sugestao.fora) motivos[f.id] = f.motivo;
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return { ...(await this.painel(data)), motivos };
  }

  /** Carga vazia, para montar à mão. Vem com o motorista de costume do caminhão. */
  async criar(data: string, caminhaoId: string | null, usuarioId: string): Promise<{ id: string }> {
    const { pool } = tenantCtx();
    try {
      const { rows } = await pool.query(
        `insert into cargas (data_entrega, caminhao_id, motorista_id, criada_por)
         values ($1, $2, (select m.id from caminhoes c join motoristas m on m.id = c.motorista_id and m.ativo where c.id = $2), $3)
         returning id`,
        [data, caminhaoId, usuarioId],
      );
      return { id: rows[0].id };
    } catch (e) {
      throw this.traduzir(e);
    }
  }

  async definir(cargaId: string, caminhaoId: string | null, motoristaId: string | null): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    await this.rascunho(cargaId);
    try {
      await pool.query(`update cargas set caminhao_id = $2, motorista_id = $3, atualizada_em = now() where id = $1`, [cargaId, caminhaoId, motoristaId]);
    } catch (e) {
      throw this.traduzir(e);
    }
    return { ok: true };
  }

  async adicionar(cargaId: string, entregaId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    if (!RE_ENTREGA.test(entregaId)) throw new BadRequestException('Entrega inválida');
    await this.rascunho(cargaId);
    const entrega = (await this.notas.listar()).entregas.find((e) => e.id === entregaId);
    if (!entrega) throw new NotFoundException('Esta entrega não está mais aguardando (foi cancelada ou já entregue)');
    const { rows } = await pool.query(`select coalesce(max(ordem), 0) + 1 as proxima from carga_entregas where carga_id = $1`, [cargaId]);
    try {
      await this.inserirEntrega(pool, cargaId, entrega, Number(rows[0].proxima));
    } catch (e) {
      throw this.traduzir(e);
    }
    return { ok: true };
  }

  async remover(cargaId: string, linhaId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    await this.rascunho(cargaId);
    const { rowCount } = await pool.query(`delete from carga_entregas where id = $1 and carga_id = $2`, [linhaId, cargaId]);
    if (!rowCount) throw new NotFoundException('Entrega não encontrada nesta carga');
    await pool.query(
      `update carga_entregas ce set ordem = x.n
         from (select id, row_number() over (order by ordem, criada_em) as n from carga_entregas where carga_id = $1) x
        where ce.id = x.id`,
      [cargaId],
    );
    return { ok: true };
  }

  /** `linhaIds` é a carga inteira na nova ordem: tem de ser exatamente as mesmas entregas. */
  async reordenar(cargaId: string, linhaIds: string[]): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    await this.rascunho(cargaId);
    const atuais = await pool.query(`select id from carga_entregas where carga_id = $1`, [cargaId]);
    const conjunto = new Set(atuais.rows.map((r) => String(r.id)));
    if (new Set(linhaIds).size !== linhaIds.length || linhaIds.length !== conjunto.size || linhaIds.some((id) => !conjunto.has(id))) {
      throw new BadRequestException('A carga mudou enquanto você reordenava. Atualize a tela e tente de novo.');
    }
    await pool.query(
      `update carga_entregas ce set ordem = x.n
         from unnest($2::uuid[]) with ordinality as x(id, n)
        where ce.id = x.id and ce.carga_id = $1`,
      [cargaId, linhaIds],
    );
    return { ok: true };
  }

  /**
   * Autoriza a saída: exige caminhão ativo, motorista ativo e ao menos uma entrega, e que nenhuma nota tenha
   * sido cancelada ou entregue desde a montagem. Atualiza a cópia dos dados (é o que vai para o romaneio).
   */
  async autorizar(cargaId: string, usuarioId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    await this.rascunho(cargaId);
    const [carga] = await this.cargasPor(pool, `c.id = $1`, [cargaId]);
    if (!carga.entregas.length) throw new BadRequestException('A carga está vazia. Inclua ao menos uma entrega.');
    if (!carga.caminhao) throw new BadRequestException('Escolha o caminhão antes de autorizar.');
    if (!carga.motorista) throw new BadRequestException('Escolha o motorista antes de autorizar.');
    const situacao = await pool.query(
      `select (select situacao from caminhoes where id = $1) as caminhao, (select ativo from motoristas where id = $2) as motorista`,
      [carga.caminhao.id, carga.motorista.id],
    );
    if (situacao.rows[0]?.caminhao !== 'ativo') throw new BadRequestException(`${carga.caminhao.nome} não está ativo. Troque o caminhão.`);
    if (situacao.rows[0]?.motorista !== true) throw new BadRequestException(`${carga.motorista.nome} está desativado. Troque o motorista.`);

    const atuais = new Map((await this.notas.listar()).entregas.map((e) => [e.id, e]));
    const sumiram = carga.entregas.filter((e) => !atuais.has(e.entregaId));
    if (sumiram.length) {
      throw new BadRequestException(
        `Tire da carga antes de autorizar (nota cancelada ou já entregue): ${sumiram.map((e) => e.dados.cliente).join(', ')}`,
      );
    }
    for (const linha of carga.entregas) {
      const e = atuais.get(linha.entregaId)!;
      await pool.query(
        `update carga_entregas set dados_json = $2, volumes = $3, peso_kg = $4, itens_sem_peso = $5 where id = $1`,
        [linha.id, JSON.stringify(e), e.volumes, e.pesoKg, e.itensSemPeso],
      );
    }
    const { rowCount } = await pool.query(
      `update cargas set status = 'autorizada', autorizada_por = $2, autorizada_em = now(), atualizada_em = now()
        where id = $1 and status = 'rascunho'`,
      [cargaId, usuarioId],
    );
    if (!rowCount) throw new ConflictException('Esta carga foi alterada por outra pessoa. Atualize a tela.');
    return { ok: true };
  }

  /** Volta a carga autorizada para rascunho (some do aplicativo do motorista). Em rota não reabre. */
  async reabrir(cargaId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `update cargas set status = 'rascunho', autorizada_por = null, autorizada_em = null, atualizada_em = now()
        where id = $1 and status = 'autorizada'`,
      [cargaId],
    );
    if (!rowCount) {
      const existe = await pool.query(`select status from cargas where id = $1`, [cargaId]);
      if (!existe.rowCount) throw new NotFoundException('Carga não encontrada');
      throw new BadRequestException(existe.rows[0].status === 'rascunho' ? 'Esta carga já está aberta para ajuste.' : 'Carga que já saiu não pode ser reaberta.');
    }
    return { ok: true };
  }

  async excluir(cargaId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    await this.rascunho(cargaId);
    await pool.query(`delete from cargas where id = $1 and status = 'rascunho'`, [cargaId]);
    return { ok: true };
  }

  /** Dados do romaneio impresso (carga em qualquer situação). */
  async romaneio(cargaId: string): Promise<Carga & { distribuidora: string }> {
    const { pool, tenant } = tenantCtx();
    const [carga] = await this.cargasPor(pool, `c.id = $1`, [cargaId]);
    if (!carga) throw new NotFoundException('Carga não encontrada');
    return { ...carga, distribuidora: tenant.nomeFantasia };
  }

  // ---------------------------------------------------------------------------------------------

  /** Garante que a carga existe e ainda é rascunho (só rascunho pode ser alterado). */
  private async rascunho(cargaId: string): Promise<void> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(`select status from cargas where id = $1`, [cargaId]);
    if (!rows[0]) throw new NotFoundException('Carga não encontrada');
    if (rows[0].status !== 'rascunho') {
      throw new BadRequestException(
        rows[0].status === 'autorizada' ? 'Esta carga já foi autorizada. Reabra a carga para mexer nela.' : 'Esta carga já saiu e não pode mais ser alterada.',
      );
    }
  }

  private async entregasVivas(db: Executor): Promise<Set<string>> {
    const { rows } = await db.query(
      `select case when ce.pedido_id is not null then 'pedido:' || ce.pedido_id::text else 'nota:' || ce.nota_entrega_id::text end as entrega_id
         from carga_entregas ce join cargas c on c.id = ce.carga_id
        where ce.viva and c.status in ${VIVAS}`,
    );
    return new Set(rows.map((r) => String(r.entrega_id)));
  }

  private async inserirEntrega(db: Executor, cargaId: string, e: EntregaPendente, ordem: number): Promise<void> {
    const [tipo, uuid] = e.id.split(':');
    await db.query(
      `insert into carga_entregas (carga_id, ordem, pedido_id, nota_entrega_id, dados_json, volumes, peso_kg, itens_sem_peso)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cargaId, ordem, tipo === 'pedido' ? uuid : null, tipo === 'nota' ? uuid : null, JSON.stringify(e), e.volumes, e.pesoKg, e.itensSemPeso],
    );
  }

  private async cargasPor(db: Executor, filtro: string, params: unknown[]): Promise<Carga[]> {
    const cargas = await db.query(
      `select c.id, c.numero, to_char(c.data_entrega, 'YYYY-MM-DD') as data, c.status, c.sugerida, c.autorizada_em,
              c.caminhao_id, k.nome as caminhao_nome, k.placa, k.capacidade_kg,
              c.motorista_id, m.nome as motorista_nome
         from cargas c
         left join caminhoes k on k.id = c.caminhao_id
         left join motoristas m on m.id = c.motorista_id
        where ${filtro}
        order by k.nome nulls last, c.numero`,
      params,
    );
    if (!cargas.rows.length) return [];
    const linhas = await db.query(
      `select id, carga_id, ordem, pedido_id, nota_entrega_id, dados_json, volumes, peso_kg, itens_sem_peso, status
         from carga_entregas
        where carga_id = any($1::uuid[])
        order by ordem, criada_em`,
      [cargas.rows.map((c) => c.id)],
    );
    return cargas.rows.map((c) => {
      const entregas: CargaEntrega[] = linhas.rows
        .filter((l) => l.carga_id === c.id)
        .map((l) => ({
          id: l.id,
          entregaId: l.pedido_id ? `pedido:${l.pedido_id}` : `nota:${l.nota_entrega_id}`,
          ordem: Number(l.ordem),
          status: l.status,
          dados: l.dados_json as EntregaPendente,
          volumes: Number(l.volumes),
          pesoKg: numeroOuNulo(l.peso_kg),
          itensSemPeso: Number(l.itens_sem_peso),
        }));
      return {
        id: c.id,
        numero: Number(c.numero),
        data: c.data,
        status: c.status,
        sugerida: c.sugerida === true,
        caminhao: c.caminhao_id ? { id: c.caminhao_id, nome: c.caminhao_nome, placa: c.placa, capacidadeKg: numeroOuNulo(c.capacidade_kg) } : null,
        motorista: c.motorista_id ? { id: c.motorista_id, nome: c.motorista_nome } : null,
        autorizadaEm: c.autorizada_em ? new Date(c.autorizada_em).toISOString() : null,
        entregas,
        volumes: arredondar(entregas.reduce((s, e) => s + e.volumes, 0), 3),
        pesoKg: arredondar(entregas.reduce((s, e) => s + (e.pesoKg ?? 0), 0), 1),
        entregasComPesoIncompleto: entregas.filter((e) => e.itensSemPeso > 0).length,
      };
    });
  }

  private traduzir(e: unknown): unknown {
    const erro = e as { code?: string; constraint?: string };
    if (erro.code === '23505') {
      if (erro.constraint === 'cargas_caminhao_dia') return new ConflictException('Este caminhão já tem carga neste dia.');
      return new ConflictException('Esta entrega já está em outra carga.');
    }
    if (erro.code === '23503') return new BadRequestException('Caminhão ou motorista não encontrado.');
    return e;
  }
}
