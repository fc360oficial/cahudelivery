import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { DatabaseService } from '../database/database.service';
import { EredeProvedor } from './erede.provedor';
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

interface ConfigErede {
  credencialArquivo: string;     // JSON fora do repo: { pv, chaveIntegracao }
  softDescriptor?: string;
  ambiente?: 'producao' | 'sandbox';
  expiracaoSegundos?: number;
}

export interface ProvedorDoTenant {
  provedor: ProvedorPagamento;
  expiracaoSegundos: number;
}

/**
 * Lê pagamento_provedores (banco de controle) e instancia os provedores do tenant
 * uma vez. Um tenant pode ter um provedor por método (itau_pix pro PIX, erede pro
 * cartão). Tenant sem linha ativa do método => null => checkout segue o fluxo antigo.
 */
@Injectable()
export class ProvedoresService {
  private readonly log = new Logger('ProvedoresService');
  private cache = new Map<string, ProvedorDoTenant[]>();

  constructor(private readonly db: DatabaseService) {}

  async obterTodos(slug: string): Promise<ProvedorDoTenant[]> {
    if (this.cache.has(slug)) return this.cache.get(slug)!;
    const { rows } = await this.db.controlPool().query(
      `select pp.provedor, pp.config_json from pagamento_provedores pp
         join tenants t on t.id = pp.tenant_id
        where t.slug = $1 and pp.ativo = true order by pp.criado_em`,
      [slug],
    );
    const lista: ProvedorDoTenant[] = [];
    for (const row of rows) {
      const cfg = row.config_json ?? {};
      const expiracaoSegundos = Number(cfg.expiracaoSegundos) || 1800;
      if (row.provedor === 'mock') lista.push({ provedor: new MockProvedor(), expiracaoSegundos });
      else if (row.provedor === 'itau_pix') lista.push({ provedor: this.itau(cfg as ConfigItau), expiracaoSegundos });
      else if (row.provedor === 'erede') lista.push({ provedor: this.erede(cfg as ConfigErede), expiracaoSegundos });
      else this.log.warn(`provedor desconhecido pro tenant ${slug}: ${row.provedor}`);
    }
    this.cache.set(slug, lista);
    return lista;
  }

  /** Primeiro provedor ativo do método. Sem argumento mantém o comportamento antigo (PIX). */
  async obter(slug: string, metodo: 'pix' | 'cartao' = 'pix'): Promise<ProvedorDoTenant | null> {
    const todos = await this.obterTodos(slug);
    return todos.find((p) => p.provedor.metodo === metodo) ?? null;
  }

  /** Provedor pelo nome gravado na linha do pagamento (consultas de pagamento antigo). */
  async obterPorNome(slug: string, nome: string): Promise<ProvedorDoTenant | null> {
    const todos = await this.obterTodos(slug);
    return todos.find((p) => p.provedor.nome === nome) ?? null;
  }

  /** sha256 do segredo do webhook, pra middleware conferir. */
  async segredoWebhookHash(slug: string): Promise<string | null> {
    const { rows } = await this.db.controlPool().query(
      `select pp.config_json->>'webhookSegredoHash' as h from pagamento_provedores pp
         join tenants t on t.id = pp.tenant_id
        where t.slug = $1 and pp.ativo = true and pp.config_json ? 'webhookSegredoHash' limit 1`,
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

  private erede(cfg: ConfigErede): EredeProvedor {
    const cred = JSON.parse(readFileSync(cfg.credencialArquivo, 'utf8'));
    return new EredeProvedor({
      pv: String(cred.pv),
      chaveIntegracao: cred.chaveIntegracao,
      softDescriptor: cfg.softDescriptor,
      ambiente: cfg.ambiente,
    });
  }
}