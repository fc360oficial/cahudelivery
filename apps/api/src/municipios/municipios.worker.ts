import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { municipiosDaUf as municipiosDaUfPadrao, normalizarNomeMunicipio } from './municipios-ibge';

const MAX_TENTATIVAS = 5;
const LOTE = 200;
const HORA_AGENDADA = 4; // 04:00 local. 03:xx é a janela da geocodificação.
const INTERVALO_MS = 1_000; // 1 req/s no IBGE
const DESLIGADO = process.env.MUNICIPIOS_DESLIGADO === 'true';

/** Regra pura da agenda: roda uma vez por dia, dentro da hora 04:xx. */
export function deveRodarAgora(agora: Date, ultimaDataRodada: string | null): boolean {
  if (agora.getHours() !== HORA_AGENDADA) return false;
  return dataLocal(agora) !== ultimaDataRodada;
}

function dataLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Deps {
  municipiosDaUf: (uf: string) => Promise<Map<string, string> | null>;
  esperar: (ms: number) => Promise<void>;
}

const depsPadrao: Deps = {
  municipiosDaUf: (uf) => municipiosDaUfPadrao(uf),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Preenche `cliente_enderecos.codigo_municipio` (IBGE) onde ele não veio do
 * ViaCEP no cadastro. Mesmo padrão do GeocodificacaoWorker: setInterval dentro
 * da API, sem fila externa. Na primeira execução faz o backfill de toda a base,
 * inclusive dos clientes que vieram do Dlinks.
 *
 * Nunca escreve no ERP; só em cliente_enderecos.
 */
@Injectable()
export class MunicipiosWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MunicipiosWorker');
  private timer: NodeJS.Timeout | null = null;
  private emAndamento = false;
  private ultimaExecucaoEm: Date | null = null;
  private ultimaDataRodada: string | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly deps: Deps = depsPadrao,
  ) {}

  onModuleInit() {
    if (DESLIGADO) return;
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

  /** Dispara em background; se já estiver rodando, não inicia outra. Sem `slug`, cobre todos os tenants. */
  dispararAgora(slug?: string): { iniciado: boolean; emAndamento: boolean } {
    if (DESLIGADO) return { iniciado: false, emAndamento: false };
    if (this.emAndamento) return { iniciado: false, emAndamento: true };
    void this.processarPendentes(slug).catch((e) => this.log.error(e));
    return { iniciado: true, emAndamento: true };
  }

  async processarPendentes(slug?: string): Promise<void> {
    if (this.emAndamento) return;
    this.emAndamento = true;
    this.ultimaDataRodada = dataLocal(new Date());
    const contagem = { processados: 0, resolvidos: 0, semCidade: 0, semLista: 0 };
    // Cache por execução: são 27 UFs no máximo, não uma requisição por endereço.
    const listas = new Map<string, Map<string, string> | null>();
    try {
      const slugs = slug ? [slug] : await this.db.listActiveTenantSlugs();
      for (const slug of slugs) {
        try {
          const pool = await this.db.getTenantPool(slug);
          const { rows } = await pool.query(
            `select id, cidade, uf from cliente_enderecos
              where codigo_municipio is null and municipio_tentativas < $1
              order by municipio_ultima_tentativa_em nulls first limit $2`,
            [MAX_TENTATIVAS, LOTE],
          );
          for (const end of rows as { id: string; cidade: string; uf: string }[]) {
            try {
              const uf = (end.uf ?? '').trim().toUpperCase();
              if (!listas.has(uf)) {
                listas.set(uf, await this.deps.municipiosDaUf(uf));
                await this.deps.esperar(INTERVALO_MS);
              }
              const lista = listas.get(uf)!;
              contagem.processados++;
              // Falha de rede não gasta tentativa: senão cinco noites ruins
              // aposentariam todos os endereços da UF para sempre.
              if (lista === null) {
                contagem.semLista++;
                continue;
              }
              const codigo = lista.get(normalizarNomeMunicipio(end.cidade ?? ''));
              if (codigo) {
                await pool.query(
                  `update cliente_enderecos
                      set codigo_municipio = $1, municipio_ultima_tentativa_em = now()
                    where id = $2`,
                  [codigo, end.id],
                );
                contagem.resolvidos++;
              } else {
                await pool.query(
                  `update cliente_enderecos
                      set municipio_tentativas = municipio_tentativas + 1, municipio_ultima_tentativa_em = now()
                    where id = $1`,
                  [end.id],
                );
                contagem.semCidade++;
              }
            } catch (e) {
              this.log.error(`municipios: falha no endereco ${slug}/${end.id}: ${e}`);
            }
          }
        } catch (e) {
          this.log.error(`municipios: falha no tenant ${slug}: ${e}`);
        }
      }
      this.log.log(
        `municipios: ${contagem.processados} processados, ${contagem.resolvidos} resolvidos, ${contagem.semCidade} sem cidade correspondente, ${contagem.semLista} sem lista do IBGE`,
      );
    } finally {
      this.emAndamento = false;
      this.ultimaExecucaoEm = new Date();
    }
  }
}
