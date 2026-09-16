import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Coordenada, EnderecoGeo, geocodificar as geocodificarPadrao } from './geocodificador';

const MAX_TENTATIVAS = 5;
const LOTE = 200;
const HORA_AGENDADA = 3; // 03:00 hora local do servidor
const INTERVALO_MS = 1_000; // 1 req/s (Nominatim)

/** Regra pura da agenda: roda uma vez por dia, dentro da hora 03:xx. */
export function deveRodarAgora(agora: Date, ultimaDataRodada: string | null): boolean {
  if (agora.getHours() !== HORA_AGENDADA) return false;
  return dataLocal(agora) !== ultimaDataRodada;
}

function dataLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Deps {
  geocodificar: (end: EnderecoGeo) => Promise<Coordenada | null>;
  esperar: (ms: number) => Promise<void>;
}

const depsPadrao: Deps = {
  geocodificar: (end) => geocodificarPadrao(end),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Geocodifica endereços de cliente sem coordenada (todos os tenants).
 * Mesmo padrão do OutboxWorker: setInterval dentro da API, sem fila externa.
 * Nunca escreve no ERP; só em cliente_enderecos.
 */
@Injectable()
export class GeocodificacaoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('GeocodificacaoWorker');
  private timer: NodeJS.Timeout | null = null;
  private emAndamento = false;
  private ultimaExecucaoEm: Date | null = null;
  private ultimaDataRodada: string | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly deps: Deps = depsPadrao,
  ) {}

  onModuleInit() {
    if (process.env.GEOCODIFICACAO_DESLIGADA === 'true') return;
    this.timer = setInterval(() => {
      const agora = new Date();
      if (!deveRodarAgora(agora, this.ultimaDataRodada)) return;
      this.ultimaDataRodada = dataLocal(agora);
      this.dispararAgora();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  estado() {
    return { emAndamento: this.emAndamento, ultimaExecucaoEm: this.ultimaExecucaoEm?.toISOString() ?? null };
  }

  /** Dispara em background; se já estiver rodando, não inicia outra. */
  dispararAgora(): { iniciado: boolean; emAndamento: boolean } {
    if (this.emAndamento) return { iniciado: false, emAndamento: true };
    void this.processarPendentes().catch((e) => this.log.error(e));
    return { iniciado: true, emAndamento: true };
  }

  async processarPendentes(): Promise<void> {
    if (this.emAndamento) return;
    this.emAndamento = true;
    this.ultimaDataRodada = dataLocal(new Date());
    const contagem = { processados: 0, porCep: 0, porEndereco: 0, falhas: 0 };
    try {
      for (const slug of await this.db.listActiveTenantSlugs()) {
        try {
          const pool = await this.db.getTenantPool(slug);
          const { rows } = await pool.query(
            `select id, cep, logradouro, numero, cidade, uf from cliente_enderecos
              where latitude is null and geo_tentativas < $1
              order by geo_ultima_tentativa_em nulls first limit $2`,
            [MAX_TENTATIVAS, LOTE],
          );
          for (const end of rows as (EnderecoGeo & { id: string })[]) {
            try {
              const coord = await this.deps.geocodificar(end);
              contagem.processados++;
              if (coord) {
                await pool.query(
                  `update cliente_enderecos
                      set latitude = $1, longitude = $2, geo_precisao = $3,
                          geocodificado_em = now(), geo_ultima_tentativa_em = now()
                    where id = $4`,
                  [coord.lat, coord.lng, coord.precisao, end.id],
                );
                if (coord.precisao === 'cep') contagem.porCep++;
                else contagem.porEndereco++;
              } else {
                await pool.query(
                  `update cliente_enderecos
                      set geo_tentativas = geo_tentativas + 1, geo_ultima_tentativa_em = now()
                    where id = $1`,
                  [end.id],
                );
                contagem.falhas++;
              }
            } catch (e) {
              contagem.falhas++;
              this.log.error(`geocodificação: falha no endereço ${slug}/${end.id}: ${e}`);
            }
            await this.deps.esperar(INTERVALO_MS);
          }
        } catch (e) {
          this.log.error(`geocodificação: falha no tenant ${slug}: ${e}`);
        }
      }
      this.log.log(
        `geocodificação: ${contagem.processados} processados, ${contagem.porCep} por CEP, ${contagem.porEndereco} por endereço, ${contagem.falhas} falhas`,
      );
    } finally {
      this.emAndamento = false;
      this.ultimaExecucaoEm = new Date();
    }
  }
}
