import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Espera máxima por uma conexão livre do pool (ou para abrir uma nova). Sem
 * isso, pool esgotado vira travamento eterno (13/11/2026: pedidos simultâneos
 * pararam a API inteira); com isso, vira erro 500 na requisição e o worker
 * registra a falha e tenta de novo no próximo ciclo.
 */
export const ESPERA_CONEXAO_MS = 10_000;

export interface TenantInfo {
  id: string;
  slug: string;
  nomeFantasia: string;
  appNome: string;
  adaptadorErp: string;
}

/**
 * Gerencia o pool do banco de CONTROLE (fluxo_control) e um pool por tenant.
 * A conexão de cada tenant vem de tenant_bancos; em dev a senha vem do env
 * (DB_PASSWORD) — em produção, senha_cifrada é decifrada com a chave do vault.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly control: Pool;
  private readonly tenantPools = new Map<string, Pool>();
  private readonly tenantInfo = new Map<string, TenantInfo>();

  constructor() {
    this.control = new Pool({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: 'fluxo_control',
      max: 5,
      connectionTimeoutMillis: ESPERA_CONEXAO_MS,
    });
  }

  controlPool(): Pool {
    return this.control;
  }

  async getTenant(slug: string): Promise<TenantInfo> {
    const cached = this.tenantInfo.get(slug);
    if (cached) return cached;
    const { rows } = await this.control.query(
      `select t.id, t.slug, t.nome_fantasia, t.app_nome, t.adaptador_erp
         from tenants t where t.slug = $1 and t.status = 'ativo'`,
      [slug],
    );
    if (!rows[0]) throw new NotFoundException(`Tenant desconhecido: ${slug}`);
    const info: TenantInfo = {
      id: rows[0].id,
      slug: rows[0].slug,
      nomeFantasia: rows[0].nome_fantasia,
      appNome: rows[0].app_nome,
      adaptadorErp: rows[0].adaptador_erp,
    };
    this.tenantInfo.set(slug, info);
    return info;
  }

  async getTenantPool(slug: string): Promise<Pool> {
    const existing = this.tenantPools.get(slug);
    if (existing) return existing;
    const tenant = await this.getTenant(slug);
    const { rows } = await this.control.query(
      `select host, porta, banco, usuario from tenant_bancos where tenant_id = $1`,
      [tenant.id],
    );
    if (!rows[0]) throw new NotFoundException(`Tenant sem banco: ${slug}`);
    const pool = new Pool({
      host: rows[0].host,
      port: rows[0].porta,
      user: rows[0].usuario,
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: rows[0].banco,
      max: 10,
      connectionTimeoutMillis: ESPERA_CONEXAO_MS,
    });
    this.tenantPools.set(slug, pool);
    return pool;
  }

  async listActiveTenantSlugs(): Promise<string[]> {
    const { rows } = await this.control.query(`select slug from tenants where status = 'ativo'`);
    return rows.map((r) => r.slug);
  }

  async onModuleDestroy() {
    await this.control.end();
    await Promise.all([...this.tenantPools.values()].map((p) => p.end()));
  }
}
