import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { DatabaseService } from '../database/database.service';
import { ItauPixProvedor } from './itau-pix.provedor';
import { MockProvedor } from './mock.provedor';
import { ProvedorPagamento } from './provedor-pagamento';

interface ConfigItau {
  chavePix: string;
  nomeRecebedor?: string;
  cidade?: string;
  expiracaoSegundos?: number;
  credencialArquivo: string;     // JSON fora do repo: { clientId, clientSecret, pfxArquivo, pfxSenha }
  webhookSegredoHash?: string;   // sha256 do segredo que vai na URL do webhook
  baseUrl?: string;
}

export interface ProvedorDoTenant {
  provedor: ProvedorPagamento;
  expiracaoSegundos: number;
}

/**
 * Lê pagamento_provedores (banco de controle) e instancia o provedor do tenant
 * uma vez. Tenant sem linha ativa => null => checkout segue o fluxo antigo.
 */
@Injectable()
export class ProvedoresService {
  private readonly log = new Logger('ProvedoresService');
  private cache = new Map<string, ProvedorDoTenant | null>();

  constructor(private readonly db: DatabaseService) {}

  async obter(slug: string): Promise<ProvedorDoTenant | null> {
    if (this.cache.has(slug)) return this.cache.get(slug)!;
    const { rows } = await this.db.controlPool().query(
      `select pp.provedor, pp.config_json from pagamento_provedores pp
         join tenants t on t.id = pp.tenant_id
        where t.slug = $1 and pp.ativo = true order by pp.criado_em limit 1`,
      [slug],
    );
    let r: ProvedorDoTenant | null = null;
    if (rows[0]) {
      const cfg = rows[0].config_json ?? {};
      const expiracaoSegundos = Number(cfg.expiracaoSegundos) || 1800;
      if (rows[0].provedor === 'mock') r = { provedor: new MockProvedor(), expiracaoSegundos };
      else if (rows[0].provedor === 'itau_pix') r = { provedor: this.itau(cfg as ConfigItau), expiracaoSegundos };
      else this.log.warn(`provedor desconhecido pro tenant ${slug}: ${rows[0].provedor}`);
    }
    this.cache.set(slug, r);
    return r;
  }

  /** sha256 do segredo do webhook, pra middleware conferir. */
  async segredoWebhookHash(slug: string): Promise<string | null> {
    const { rows } = await this.db.controlPool().query(
      `select pp.config_json->>'webhookSegredoHash' as h from pagamento_provedores pp
         join tenants t on t.id = pp.tenant_id where t.slug = $1 and pp.ativo = true limit 1`,
      [slug],
    );
    return rows[0]?.h ?? null;
  }

  /** Resolve o tenant a partir do hash do segredo da URL. */
  async slugPorSegredoHash(hash: string): Promise<string | null> {
    const { rows } = await this.db.controlPool().query(
      `select t.slug from pagamento_provedores pp join tenants t on t.id = pp.tenant_id
        where pp.ativo = true and pp.config_json->>'webhookSegredoHash' = $1 limit 1`,
      [hash],
    );
    return rows[0]?.slug ?? null;
  }

  private itau(cfg: ConfigItau): ItauPixProvedor {
    const cred = JSON.parse(readFileSync(cfg.credencialArquivo, 'utf8'));
    return new ItauPixProvedor({
      chavePix: cfg.chavePix,
      nomeRecebedor: cfg.nomeRecebedor ?? 'CAHU DISTRIBUIDORA',
      cidade: cfg.cidade ?? 'RECIFE',
      clientId: cred.clientId,
      clientSecret: cred.clientSecret,
      pfx: readFileSync(cred.pfxArquivo),
      pfxSenha: cred.pfxSenha,
      baseUrl: cfg.baseUrl,
    });
  }
}
