import { Injectable } from '@nestjs/common';
import { GeocodificacaoWorker } from '../geo/geocodificacao.worker';
import { tenantCtx } from '../tenancy/tenant-context';
import { FiltrosMapa } from './mapa-filtros';

/** Dados da tela Mapa: só leitura do banco do tenant; nunca chama serviço externo. */
@Injectable()
export class MapaService {
  constructor(private readonly geo: GeocodificacaoWorker) {}

  async mapa(f: FiltrosMapa) {
    const { pool } = tenantCtx();
    const [clientes, pedidos, semLoc] = await Promise.all([
      pool.query(
        `select distinct on (c.id)
                c.id, c.nome_fantasia as nome, c.documento, e.cidade, e.bairro,
                concat_ws(', ', e.logradouro, e.numero) as endereco,
                e.latitude as lat, e.longitude as lng, e.geo_precisao as precisao
           from clientes c
           join cliente_enderecos e on e.cliente_id = c.id and e.latitude is not null
          where c.status not in ('bloqueado', 'excluido')
          order by c.id, e.padrao desc, e.id`,
      ),
      pool.query(
        `select p.id, p.numero, p.cliente_id as "clienteId", c.nome_fantasia as cliente, p.status,
                p.total::float as total, p.criado_em as "criadoEm",
                concat_ws(', ', e.logradouro, e.numero) || ' - ' || e.bairro || ', ' || e.cidade as endereco,
                e.latitude as lat, e.longitude as lng, e.geo_precisao as precisao
           from pedidos p
           join clientes c on c.id = p.cliente_id
           left join lateral (
             select e1.* from cliente_enderecos e1
              where e1.cliente_id = p.cliente_id and e1.latitude is not null
                and (e1.id::text = p.endereco_snapshot_json->>'id' or e1.padrao)
              order by (e1.id::text = p.endereco_snapshot_json->>'id') desc, e1.padrao desc
              limit 1
           ) e on true
          where p.criado_em::date between $1 and $2
            and p.status = any($3)
            and e.id is not null
          order by p.criado_em desc`,
        [f.de, f.ate, f.status],
      ),
      pool.query(
        `select
           (select count(*)::int from clientes c
             where c.status not in ('bloqueado', 'excluido')
               and not exists (select 1 from cliente_enderecos e where e.cliente_id = c.id and e.latitude is not null)) as clientes,
           (select count(*)::int from pedidos p
             where p.criado_em::date between $1 and $2 and p.status = any($3)
               and not exists (
                 select 1 from cliente_enderecos e
                  where e.cliente_id = p.cliente_id and e.latitude is not null
                    and (e.id::text = p.endereco_snapshot_json->>'id' or e.padrao)
               )) as pedidos`,
        [f.de, f.ate, f.status],
      ),
    ]);
    return {
      clientes: clientes.rows,
      pedidos: pedidos.rows,
      semLocalizacao: semLoc.rows[0],
      geocodificacao: this.geo.estado(),
    };
  }

  geocodificarAgora() {
    return this.geo.dispararAgora(tenantCtx().tenant.slug);
  }
}
