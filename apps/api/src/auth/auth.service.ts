import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { tenantCtx } from '../tenancy/tenant-context';
import { excluirCliente } from '../clientes/excluir-cliente';
import { senhaFraca } from './senha-provisoria';
import { CODIGO_MAX_TENTATIVAS, hashCodigoAcesso } from './codigo-acesso';
import { LimiteAuthService } from './limite-auth.service';
import { resolverInscricaoEstadual } from './inscricao-estadual';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_DIAS = 90; // cliente que abre o app pelo menos 1x a cada 90 dias nunca precisa logar de novo
const MSG_SENHA_FRACA = 'Essa senha é fácil de adivinhar. Escolha outra.';

function codigoConfere(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly limite: LimiteAuthService,
  ) {}

  async registrar(
    dados: {
      tipo: 'CPF' | 'CNPJ';
      documento: string;
      nomeFantasia: string;
      razaoSocial?: string;
      email?: string;
      telefone: string;
      endereco: {
        cep: string;
        logradouro: string;
        numero: string;
        complemento?: string;
        bairro: string;
        cidade: string;
        uf: string;
        codigoMunicipio?: string;
      };
      categoria?: string;
      inscricaoEstadual?: string;
      isentoIe?: boolean;
      senha: string;
      codigoIndicacao?: string;
    },
    deviceId?: string,
  ) {
    const { pool } = tenantCtx();
    const doc = dados.documento.replace(/\D/g, '');
    if (senhaFraca(dados.senha, doc)) throw new BadRequestException(MSG_SENHA_FRACA);
    const ie = resolverInscricaoEstadual(dados);
    if (!ie.ok) throw new BadRequestException(ie.erro);
    const client = await pool.connect();
    let novo: { id: string; status: string };
    try {
      await client.query('begin');
      const dup = await client.query(
        `select cc.senha_provisoria
           from clientes c left join cliente_credenciais cc on cc.cliente_id = c.id
          where c.documento = $1`,
        [doc],
      );
      if (dup.rowCount) {
        const provisoria = dup.rows[0].senha_provisoria === true;
        throw new ConflictException({
          statusCode: 409,
          message: provisoria
            ? 'Você já é cliente CAHU. Peça à distribuidora o código de acesso para criar sua senha.'
            : 'Já existe cadastro para este CNPJ/CPF. Use Entrar.',
          codigo: provisoria ? 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO' : 'CLIENTE_JA_EXISTE',
        });
      }
      let indicadoPorClienteId: string | null = null;
      if (dados.codigoIndicacao) {
        const ind = await client.query(`select id from clientes where codigo_indicacao = $1`, [
          dados.codigoIndicacao.trim().toUpperCase(),
        ]);
        if (!ind.rows[0]) throw new BadRequestException('Código de indicação inválido');
        indicadoPorClienteId = ind.rows[0].id;
      }
      const codigoIndicacao = await this.gerarCodigoIndicacao(client);
      const { rows } = await client.query(
        `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, telefone, categoria, codigo_indicacao, indicado_por_cliente_id, inscricao_estadual)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, status`,
        [
          dados.tipo,
          doc,
          dados.razaoSocial ?? null,
          dados.nomeFantasia,
          dados.email?.trim().toLowerCase() || null,
          dados.telefone.trim(),
          dados.categoria ?? null,
          codigoIndicacao,
          indicadoPorClienteId,
          ie.valor,
        ],
      );
      const e = dados.endereco;
      await client.query(
        `insert into cliente_enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao, codigo_municipio)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
        [
          rows[0].id,
          e.cep.replace(/\D/g, ''),
          e.logradouro.trim(),
          e.numero.trim(),
          e.complemento?.trim() || null,
          e.bairro.trim(),
          e.cidade.trim(),
          e.uf.trim().toUpperCase(),
          e.codigoMunicipio?.replace(/\D/g, '') || null,
        ],
      );
      await client.query(`insert into cliente_credenciais (cliente_id, senha_hash, senha_definida_em) values ($1,$2,now())`, [
        rows[0].id,
        await argon2.hash(dados.senha),
      ]);
      await client.query('commit');
      novo = rows[0];
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    await this.reivindicarCarrinho(novo.id, deviceId);
    const tokens = await this.emitirTokens(novo.id, tenantCtx().tenant.slug);
    return { clienteId: novo.id, status: novo.status, ...tokens };
  }

  /** 6 caracteres, sem 0/O/1/I (evita confusão visual) — retry em caso de colisão rara. */
  private async gerarCodigoIndicacao(client: import('pg').PoolClient): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      let codigo = '';
      for (let i = 0; i < 6; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
      const existe = await client.query(`select 1 from clientes where codigo_indicacao = $1`, [codigo]);
      if (!existe.rowCount) return codigo;
    }
    throw new Error('Não foi possível gerar código de indicação único');
  }

  async login(
    identificador: string,
    senha: string,
    ip: string,
    deviceId?: string,
  ): Promise<TokenPair & { status: string }> {
    const { pool, tenant } = tenantCtx();
    const doc = identificador.replace(/\D/g, '');
    const chaves = [`doc:${doc}`, `ip:${ip}`];
    await this.limite.conferir(chaves);
    const { rows } = await pool.query(
      `select c.id, c.status, cc.senha_hash, cc.senha_provisoria
         from clientes c join cliente_credenciais cc on cc.cliente_id = c.id
        where c.documento = $1`,
      [doc],
    );
    const reg = rows[0];
    if (reg?.senha_provisoria) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Você ainda não criou sua senha. Peça à distribuidora o código de acesso.',
        codigo: 'PRIMEIRO_ACESSO_PENDENTE',
      });
    }
    if (!reg || !(await argon2.verify(reg.senha_hash, senha))) {
      await this.limite.registrarFalha(chaves);
      throw new UnauthorizedException('CNPJ/CPF ou senha inválidos');
    }
    if (reg.status === 'bloqueado' || reg.status === 'excluido') throw new UnauthorizedException('Cadastro bloqueado');
    await this.limite.limpar(chaves[0]);
    await pool.query(`update cliente_credenciais set ultimo_login_em = now() where cliente_id = $1`, [reg.id]);
    await this.reivindicarCarrinho(reg.id, deviceId);
    return { ...(await this.emitirTokens(reg.id, tenant.slug)), status: reg.status };
  }

  /**
   * Primeiro acesso e "esqueci minha senha": com o código da retaguarda o cliente
   * cria a senha e já entra. A senha anterior vale até aqui, e as sessões abertas
   * caem com a troca. Código errado conta tentativa nele e no limite de login.
   */
  async primeiroAcesso(
    identificador: string,
    codigo: string,
    novaSenha: string,
    ip: string,
    deviceId?: string,
  ): Promise<TokenPair & { status: string }> {
    const { pool, tenant } = tenantCtx();
    const doc = identificador.replace(/\D/g, '');
    const chaves = [`doc:${doc}`, `ip:${ip}`];
    await this.limite.conferir(chaves);
    if (senhaFraca(novaSenha, doc)) throw new BadRequestException(MSG_SENHA_FRACA);
    const senhaHash = await argon2.hash(novaSenha);

    const client = await pool.connect();
    let cliente: { id: string; status: string } | undefined;
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `select c.id, c.status, k.codigo_hash, k.tentativas
           from clientes c
           join cliente_codigos_acesso k on k.cliente_id = c.id
          where c.documento = $1 and c.status not in ('bloqueado','excluido')
            and k.usado_em is null and k.expira_em > now() and k.tentativas < $2
          for update of k`,
        [doc, CODIGO_MAX_TENTATIVAS],
      );
      const k = rows[0];
      if (k && codigoConfere(hashCodigoAcesso(k.id, codigo), k.codigo_hash)) {
        await client.query(`update cliente_codigos_acesso set usado_em = now() where cliente_id = $1`, [k.id]);
        await client.query(
          `insert into cliente_credenciais (cliente_id, senha_hash, senha_provisoria, senha_definida_em, ultimo_login_em)
           values ($1,$2,false,now(),now())
           on conflict (cliente_id) do update set senha_hash = excluded.senha_hash, senha_provisoria = false,
             senha_definida_em = now(), ultimo_login_em = now()`,
          [k.id, senhaHash],
        );
        // Apaga em vez de revogar: o refresh aceita token revogado há menos de 30 s.
        await client.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'cliente'`, [k.id]);
        await client.query(
          `insert into auditoria (acao, entidade, entidade_id) values ('senha_por_codigo','cliente',$1)`,
          [k.id],
        );
        cliente = { id: k.id, status: k.status };
      } else if (k) {
        await client.query(`update cliente_codigos_acesso set tentativas = tentativas + 1 where cliente_id = $1`, [k.id]);
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    if (!cliente) {
      await this.limite.registrarFalha(chaves);
      throw new BadRequestException({
        statusCode: 400,
        message: 'Código inválido ou vencido. Confira os dados ou peça um novo à distribuidora.',
        codigo: 'CODIGO_INVALIDO',
      });
    }
    await this.limite.limpar(chaves[0]);
    await this.reivindicarCarrinho(cliente.id, deviceId);
    return { ...(await this.emitirTokens(cliente.id, tenant.slug)), status: cliente.status };
  }

  /**
   * O cliente exclui a própria conta. Pedido em andamento e crédito na carteira
   * travam: o dinheiro é dele e sem a conta não haveria como usar ou devolver.
   */
  async excluirConta(identificador: string, senha: string, ip: string) {
    const { pool } = tenantCtx();
    const doc = identificador.replace(/\D/g, '');
    const chaves = [`doc:${doc}`, `ip:${ip}`];
    await this.limite.conferir(chaves);
    const { rows } = await pool.query(
      `select c.id, c.status, cc.senha_hash, cc.senha_provisoria
         from clientes c join cliente_credenciais cc on cc.cliente_id = c.id
        where c.documento = $1`,
      [doc],
    );
    const reg = rows[0];
    if (!reg || reg.senha_provisoria || reg.status === 'excluido' || !(await argon2.verify(reg.senha_hash, senha))) {
      await this.limite.registrarFalha(chaves);
      throw new UnauthorizedException('CNPJ/CPF ou senha inválidos');
    }
    await this.limite.limpar(chaves[0]);
    if (reg.status === 'bloqueado') throw new UnauthorizedException('Cadastro bloqueado');
    const pedidos = await pool.query(
      `select 1 from pedidos where cliente_id = $1 and status not in ('ENTREGUE','CANCELADO') limit 1`,
      [reg.id],
    );
    if (pedidos.rowCount) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Você tem pedido em andamento. Exclua a conta depois que ele for entregue ou cancelado.',
        codigo: 'PEDIDO_EM_ANDAMENTO',
      });
    }
    const carteira = await pool.query(
      `select coalesce(sum(valor),0) as saldo from carteira_movimentos where cliente_id = $1`,
      [reg.id],
    );
    const saldo = Number(carteira.rows[0].saldo);
    if (saldo > 0.009) {
      throw new ConflictException({
        statusCode: 409,
        message: `Você tem R$ ${saldo.toFixed(2).replace('.', ',')} de crédito na carteira. Use o crédito ou peça a devolução à distribuidora antes de excluir a conta.`,
        codigo: 'CREDITO_NA_CARTEIRA',
      });
    }
    await excluirCliente(pool, reg.id, null, 'cliente');
    return { ok: true };
  }

  /**
   * Troca a senha do cliente logado. As outras sessões caem (refresh tokens apagados na
   * mesma transação) e a resposta traz um par novo para quem trocou continuar logado.
   */
  async definirSenha(clienteId: string, senhaAtual: string, novaSenha: string): Promise<{ ok: true } & TokenPair> {
    const { pool, tenant } = tenantCtx();
    const { rows } = await pool.query(
      `select cc.senha_hash, cc.senha_provisoria, c.documento
         from cliente_credenciais cc join clientes c on c.id = cc.cliente_id
        where cc.cliente_id = $1`,
      [clienteId],
    );
    if (!rows[0] || rows[0].senha_provisoria || !(await argon2.verify(rows[0].senha_hash, senhaAtual))) {
      throw new UnauthorizedException('Senha atual incorreta');
    }
    if (senhaFraca(novaSenha, rows[0].documento)) throw new BadRequestException(MSG_SENHA_FRACA);
    const senhaHash = await argon2.hash(novaSenha);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update cliente_credenciais set senha_hash = $2, senha_provisoria = false, senha_definida_em = now() where cliente_id = $1`,
        [clienteId, senhaHash],
      );
      // Apaga em vez de revogar: o refresh aceita token revogado há menos de 30 s.
      await client.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'cliente'`, [clienteId]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    // Depois do commit: o par novo não pode cair junto com os antigos.
    return { ok: true, ...(await this.emitirTokens(clienteId, tenant.slug)) };
  }

  /**
   * `deviceId`: se ficou algum carrinho anônimo no aparelho (itens adicionados
   * enquanto o access token estava vencido, antes do fix do OptionalAuthGuard),
   * ele é mesclado no carrinho do cliente aqui — a renovação é o 1º ponto em que
   * o app volta a saber quem é o cliente.
   */
  async refresh(refreshToken: string, deviceId?: string): Promise<TokenPair> {
    const { pool, tenant } = tenantCtx();
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    // Rotação com janela de tolerância: um token recém-usado (até 30s) ainda vale, pra
    // duas renovações simultâneas do mesmo aparelho (ou duas abas no web) não derrubarem
    // a sessão. Fora da janela, reuso = token inválido.
    const { rows } = await pool.query(
      `update refresh_tokens set revogado_em = coalesce(revogado_em, now())
        where token_hash = $1 and sujeito = 'cliente' and expira_em > now()
          and (revogado_em is null or revogado_em > now() - interval '30 seconds')
        returning sujeito_id`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('Refresh token inválido ou expirado');
    await this.reivindicarCarrinho(rows[0].sujeito_id, deviceId);
    return this.emitirTokens(rows[0].sujeito_id, tenant.slug);
  }

  private async emitirTokens(clienteId: string, slug: string): Promise<TokenPair> {
    const { pool } = tenantCtx();
    const refreshToken = randomBytes(48).toString('base64url');
    await pool.query(
      `insert into refresh_tokens (sujeito_id, sujeito, token_hash, expira_em)
       values ($1,'cliente',$2, now() + interval '${REFRESH_DIAS} days')`,
      [clienteId, createHash('sha256').update(refreshToken).digest('hex')],
    );
    const accessToken = await this.jwt.signAsync({ sub: clienteId, slug, tipo: 'cliente' });
    return { accessToken, refreshToken };
  }

  /** Mescla o carrinho anônimo do dispositivo no carrinho do cliente (maior quantidade vence). */
  private async reivindicarCarrinho(clienteId: string, deviceId?: string) {
    if (!deviceId) return;
    const { pool } = tenantCtx();
    const dev = await pool.query(`select id from carrinhos where device_id = $1`, [deviceId]);
    if (!dev.rows[0]) return;
    const cli = await pool.query(
      `insert into carrinhos (cliente_id) values ($1)
       on conflict (cliente_id) where cliente_id is not null do update set atualizado_em = now()
       returning id`,
      [clienteId],
    );
    await pool.query(
      `insert into carrinho_itens (carrinho_id, produto_id, quantidade, preco_unit_snapshot)
       select $1, produto_id, quantidade, preco_unit_snapshot from carrinho_itens where carrinho_id = $2
       on conflict (carrinho_id, produto_id)
         do update set quantidade = greatest(carrinho_itens.quantidade, excluded.quantidade)`,
      [cli.rows[0].id, dev.rows[0].id],
    );
    await pool.query(`delete from carrinho_itens where carrinho_id = $1`, [dev.rows[0].id]);
    await pool.query(`delete from carrinhos where id = $1`, [dev.rows[0].id]);
  }
}
