# Login por CNPJ/CPF, email opcional e senha provisória — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cliente entra no app só com CNPJ/CPF; clientes vindos do Dlinks entram com a senha inicial `123456` e são obrigados a trocá-la; email vira contato opcional e repetível.

**Architecture:** Migração tenant 019 relaxa `clientes.email` e adiciona `cliente_credenciais.senha_provisoria`. A API (NestJS) passa a autenticar só por `documento`, devolve `senhaProvisoria` no login, ganha `POST /auth/senha` e `POST /admin/clientes/:id/redefinir-senha`; o sync do Dlinks cria credencial provisória para cliente novo. O app Flutter troca o campo de login, força a tela de nova senha e torna o email opcional no cadastro. A retaguarda React ganha o botão de redefinir.

**Tech Stack:** PostgreSQL 16, NestJS 11 + class-validator + argon2 + pg, Flutter (Material 3, `ApiClient` singleton), React + TS (Vite), `curl` para verificação real (padrão do projeto — não há suíte de testes automatizados na API).

Spec: `docs/superpowers/specs/2026-09-10-login-por-documento-senha-provisoria-design.md`

## Global Constraints

- Senha inicial provisória: exatamente `123456`. `POST /auth/senha` rejeita `123456` como nova senha.
- Mensagem de cadastro com documento já existente e credencial provisória: `"Você já é cliente CAHU. Entre com seu CNPJ/CPF e a senha inicial 123456."`, código `CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO`. Com credencial definitiva: `"Já existe cadastro para este CNPJ/CPF. Use Entrar."`, código `CLIENTE_JA_EXISTE`.
- Login aceita apenas documento (dígitos); email não é mais identificador.
- Migrações SQL vivem em `infra/sql/tenant/` e são espelhadas em `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\` (fora do repo — copiar o arquivo).
- Commits direto na `main` (padrão do projeto). Mensagens em português, prefixo `feat(api):`, `feat(app):`, `feat(admin):`, `db:`, `docs:`.
- Ambiente local: API em `apps/api` (`node dist/main.js` após `npm run build`, porta 3000, Postgres local `fluxo_t_cahu`, tenant `cahu`, header `X-Tenant: cahu`). Dev DB: usuário `postgres`, senha `postgres`.
- Deploy em produção: `git pull` + `npm run build` em `C:\cahudelivery\apps\api` via SSH (`ssh -i ~/.ssh/claude_254 claude-ssh@192.168.2.254`), depois `type nul > C:\cahudelivery\restart-api.flag` (restart automático em até 1 min). Migração em produção é aplicada pelo Tiago com psql (a conta SSH não tem a senha do banco).

---

### Task 1: Migração 019 — email opcional/repetível, senha provisória

**Files:**
- Create: `infra/sql/tenant/019_login_por_documento.sql`
- Copy to: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\019_login_por_documento.sql`

**Interfaces:**
- Produces: coluna `cliente_credenciais.senha_provisoria boolean not null default false`; `clientes.email` nullable e sem unique.

- [ ] **Step 1: Gerar o hash argon2 de `123456`**

Run (em `apps/api`):
```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/api" && node -e "require('argon2').hash('123456').then(h => console.log(h))"
```
Expected: uma linha começando com `$argon2id$v=19$m=65536,t=3,p=4$...`. Copie essa linha inteira — ela entra no SQL do passo 2 no lugar de `HASH_AQUI`.

- [ ] **Step 2: Escrever a migração**

`infra/sql/tenant/019_login_por_documento.sql`:
```sql
-- 019: login por documento. Email vira contato (opcional, pode repetir);
-- clientes sem senha (vindos do Dlinks) ganham a senha inicial provisória 123456.

alter table clientes alter column email drop not null;
alter table clientes drop constraint if exists clientes_email_key;

alter table cliente_credenciais
  add column if not exists senha_provisoria boolean not null default false;

-- placeholders criados pela sync do Dlinks viram "sem email"
update clientes set email = null where email like '%@sem-email.dlinks.local';

-- hash argon2id de "123456" (qualquer hash válido serve para todas as linhas)
insert into cliente_credenciais (cliente_id, senha_hash, senha_provisoria)
select c.id, 'HASH_AQUI', true
  from clientes c
 where not exists (select 1 from cliente_credenciais cc where cc.cliente_id = c.id);
```
Substitua `HASH_AQUI` pelo hash do passo 1 (mantendo as aspas simples).

- [ ] **Step 3: Aplicar no banco local e verificar**

Run:
```bash
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/infra/sql/tenant/019_login_por_documento.sql"
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -c "select is_nullable from information_schema.columns where table_name='clientes' and column_name='email'" -c "select count(*) from pg_constraint where conname='clientes_email_key'" -c "select count(*) as sem_credencial from clientes c where not exists (select 1 from cliente_credenciais cc where cc.cliente_id=c.id)"
```
Expected: `is_nullable = YES`; `count = 0`; `sem_credencial = 0`.

- [ ] **Step 4: Espelhar em `11 - SQL` e commitar**

```bash
cp "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/infra/sql/tenant/019_login_por_documento.sql" "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/11 - SQL/tenant/"
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git add infra/sql/tenant/019_login_por_documento.sql && git commit -m "db: email opcional/repetível e senha provisória (migração 019)"
```

---

### Task 2: Sync do Dlinks grava email real e cria credencial provisória

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/dlinks-sync.service.ts` (método `syncClientes`, ~linhas 143-215)

**Interfaces:**
- Consumes: `cliente_credenciais.senha_provisoria` (Task 1).
- Produces: constante exportada `SENHA_PROVISORIA = '123456'` em `apps/api/src/auth/senha-provisoria.ts` (usada pelas Tasks 3 e 5).

- [ ] **Step 1: Criar a constante compartilhada**

`apps/api/src/auth/senha-provisoria.ts`:
```ts
import * as argon2 from 'argon2';

export const SENHA_PROVISORIA = '123456';

export const hashSenhaProvisoria = () => argon2.hash(SENHA_PROVISORIA);
```

- [ ] **Step 2: Reescrever `syncClientes`**

Substituir o método inteiro (do docblock até o `return`) por:
```ts
  /**
   * Cliente é identificado pelo `documento` (não pelo erp_cliente_id): um
   * cliente pode já existir por ter se cadastrado sozinho no app antes do
   * Dlinks empurrar o cadastro dele — nesse caso a linha existente é
   * atualizada, não duplicada. O endereço só é gravado na criação, pra não
   * sobrescrever um endereço que o cliente já tenha editado no app.
   *
   * Email é só contato (pode repetir, pode faltar). O Dlinks manda a chave
   * como "Email"; o contrato documenta "email" — aceitamos as duas. Ausente
   * nunca apaga um email já gravado. Cliente novo ganha a senha provisória.
   */
  async syncClientes(itens: ClienteDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    const ignorados: ResultadoSync['ignorados'] = [];
    for (const item of itens) {
      const documento = item.cnpj_cpf.replace(/\D/g, '');
      const tipo = documento.length === 11 ? 'CPF' : 'CNPJ';
      const email = (item.email ?? item.Email ?? null)?.trim().toLowerCase() || null;
      try {
        const { rows } = await pool.query(
          `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, status, erp_cliente_id, limite_credito, saldo_titulos_aberto, codigo_indicacao)
           values ($1, $2, $3, $3, $4, 'aprovado', $5, $6, $7, upper(substring(md5(random()::text) from 1 for 6)))
           on conflict (documento) do update set
             razao_social = excluded.razao_social,
             email = coalesce(excluded.email, clientes.email),
             erp_cliente_id = excluded.erp_cliente_id,
             limite_credito = excluded.limite_credito,
             saldo_titulos_aberto = excluded.saldo_titulos_aberto
           returning id, (xmax = 0) as inserido`,
          [tipo, documento, item.razao_social, email, item.codigo, item.limite_credito ?? null, item.saldo_titulos_aberto ?? null],
        );
        const { id: clienteId, inserido } = rows[0];
        if (inserido) {
          await pool.query(
            `insert into cliente_enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao)
             values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
            [
              clienteId,
              item.endereco.cep,
              item.endereco.logradouro,
              item.endereco.numero,
              item.endereco.complemento ?? null,
              item.endereco.bairro,
              item.endereco.cidade,
              item.endereco.uf,
            ],
          );
          await pool.query(
            `insert into cliente_credenciais (cliente_id, senha_hash, senha_provisoria)
             values ($1, $2, true)
             on conflict (cliente_id) do nothing`,
            [clienteId, await hashSenhaProvisoria()],
          );
        }
        processados++;
      } catch (e) {
        ignorados.push({ item, motivo: e instanceof Error ? e.message : 'erro_desconhecido' });
      }
    }
    const motivos = ignorados
      .slice(0, 3)
      .map((i) => `${(i.item as ClienteDto).cnpj_cpf}: ${i.motivo}`)
      .join(' | ');
    await this.registrarLog(
      'sync_clientes',
      `${processados} cliente(s), ${ignorados.length} ignorado(s)${motivos ? ` — ${motivos}` : ''}`,
      ignorados.length === 0,
    );
    return { processados, ignorados };
  }
```
E adicionar no topo do arquivo: `import { hashSenhaProvisoria } from '../auth/senha-provisoria';`

- [ ] **Step 3: Build e subir a API local**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/api" && npm run build && (node dist/main.js > /tmp/api.log 2>&1 &) && sleep 4 && tail -n 2 /tmp/api.log
```
Expected: build sem erro; log termina com `Nest application successfully started`.

- [ ] **Step 4: Verificar com curl (apikey de dev)**

A apikey de dev está em `integracao_credenciais` do banco `fluxo_control` local; se não souber o valor, gere uma:
```bash
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"); echo $KEY
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_control -c "insert into integracao_credenciais (tenant_id, adaptador, apikey_hash, ativo) select id, 'dlinks', encode(sha256('$KEY'::bytea),'hex'), true from tenants where slug='cahu'"
```
Dois clientes com o mesmo email, um deles com `Email` maiúsculo, um terceiro sem email:
```bash
B=http://localhost:3000/v1/integracoes/dlinks/clientes
curl -s -X POST $B -H "apikey: $KEY" -H "Content-Type: application/json" -d '{"codigo":"T1","razao_social":"TESTE UM","cnpj_cpf":"11111111000191","email":"contador@teste.com","endereco":{"logradouro":"R A","numero":"1","bairro":"B","cidade":"C","uf":"PE","cep":"50000000"}}'; echo
curl -s -X POST $B -H "apikey: $KEY" -H "Content-Type: application/json" -d '{"codigo":"T2","razao_social":"TESTE DOIS","cnpj_cpf":"22222222000191","Email":"contador@teste.com","endereco":{"logradouro":"R A","numero":"1","bairro":"B","cidade":"C","uf":"PE","cep":"50000000"}}'; echo
curl -s -X POST $B -H "apikey: $KEY" -H "Content-Type: application/json" -d '{"codigo":"T3","razao_social":"TESTE TRES","cnpj_cpf":"33333333000191","endereco":{"logradouro":"R A","numero":"1","bairro":"B","cidade":"C","uf":"PE","cep":"50000000"}}'; echo
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -c "select c.documento, c.email, cc.senha_provisoria from clientes c join cliente_credenciais cc on cc.cliente_id=c.id where c.documento in ('11111111000191','22222222000191','33333333000191') order by 1"
```
Expected: três respostas `{"processados":1,"ignorados":[]}`; consulta mostra T1 e T2 com `contador@teste.com`, T3 com email vazio, todos `senha_provisoria = t`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git add apps/api/src/auth/senha-provisoria.ts apps/api/src/integracoes-dlinks/dlinks-sync.service.ts && git commit -m "feat(api): sync do Dlinks grava email real (repetível) e cria senha provisória"
```

---

### Task 3: Login só por documento, `senhaProvisoria` na resposta e `POST /auth/senha`

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` (método `login`, linhas 96-113; adicionar `definirSenha`)
- Modify: `apps/api/src/auth/auth.controller.ts` (LoginDto, novo endpoint)

**Interfaces:**
- Consumes: `SENHA_PROVISORIA` (Task 2); `JwtAuthGuard`/`ClienteLogado` de `apps/api/src/auth/jwt.guard.ts` (existente: `req.cliente.clienteId`).
- Produces: resposta do login `{ accessToken, refreshToken, status, senhaProvisoria: boolean }`; `POST /v1/auth/senha` body `{ senhaAtual, novaSenha }` → `{ ok: true }`.

- [ ] **Step 1: Trocar `login` e adicionar `definirSenha` em `auth.service.ts`**

Substituir o método `login` por:
```ts
  async login(
    identificador: string,
    senha: string,
    deviceId?: string,
  ): Promise<TokenPair & { status: string; senhaProvisoria: boolean }> {
    const { pool, tenant } = tenantCtx();
    const doc = identificador.replace(/\D/g, '');
    const { rows } = await pool.query(
      `select c.id, c.status, cc.senha_hash, cc.senha_provisoria
         from clientes c join cliente_credenciais cc on cc.cliente_id = c.id
        where c.documento = $1`,
      [doc],
    );
    const reg = rows[0];
    if (!reg || !(await argon2.verify(reg.senha_hash, senha))) {
      throw new UnauthorizedException('CNPJ/CPF ou senha inválidos');
    }
    if (reg.status === 'bloqueado' || reg.status === 'excluido') throw new UnauthorizedException('Cadastro bloqueado');
    await pool.query(`update cliente_credenciais set ultimo_login_em = now() where cliente_id = $1`, [reg.id]);
    await this.reivindicarCarrinho(reg.id, deviceId);
    return { ...(await this.emitirTokens(reg.id, tenant.slug)), status: reg.status, senhaProvisoria: reg.senha_provisoria };
  }

  async definirSenha(clienteId: string, senhaAtual: string, novaSenha: string) {
    const { pool } = tenantCtx();
    if (novaSenha === SENHA_PROVISORIA) throw new BadRequestException('Escolha uma senha diferente da senha inicial');
    const { rows } = await pool.query(`select senha_hash from cliente_credenciais where cliente_id = $1`, [clienteId]);
    if (!rows[0] || !(await argon2.verify(rows[0].senha_hash, senhaAtual))) {
      throw new UnauthorizedException('Senha atual incorreta');
    }
    await pool.query(
      `update cliente_credenciais set senha_hash = $2, senha_provisoria = false where cliente_id = $1`,
      [clienteId, await argon2.hash(novaSenha)],
    );
    return { ok: true };
  }
```
Adicionar import: `import { SENHA_PROVISORIA } from './senha-provisoria';`

- [ ] **Step 2: Controller**

Em `auth.controller.ts`, trocar `LoginDto` e adicionar `SenhaDto` + endpoint:
```ts
class LoginDto {
  @IsNotEmpty() identificador!: string; // CNPJ ou CPF (só dígitos são considerados)
  @IsNotEmpty() senha!: string;
}

class SenhaDto {
  @IsNotEmpty() senhaAtual!: string;
  @MinLength(6) novaSenha!: string;
}
```
Imports: `import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';`, `import type { Request } from 'express';`, `import { JwtAuthGuard, ClienteLogado } from './jwt.guard';` e `type ReqCliente = Request & { cliente: ClienteLogado };`. Endpoint dentro da classe:
```ts
  @Post('senha')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  senha(@Req() req: ReqCliente, @Body() dto: SenhaDto) {
    return this.auth.definirSenha(req.cliente.clienteId, dto.senhaAtual, dto.novaSenha);
  }
```

- [ ] **Step 3: Build, reiniciar API local e verificar**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/api" && npm run build && (pkill -f "dist/main.js" || true) && (node dist/main.js > /tmp/api.log 2>&1 &) && sleep 4
A=http://localhost:3000/v1/auth
echo "1) login T3 com 123456"; curl -s -X POST $A/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"33.333.333/0001-91","senha":"123456"}'; echo
echo "2) login por email deve falhar"; curl -s -X POST $A/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"contador@teste.com","senha":"123456"}'; echo
TOK=$(curl -s -X POST $A/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"33333333000191","senha":"123456"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken')
echo "3) nova senha = 123456 deve falhar"; curl -s -X POST $A/senha -H "X-Tenant: cahu" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"senhaAtual":"123456","novaSenha":"123456"}'; echo
echo "4) nova senha valida"; curl -s -X POST $A/senha -H "X-Tenant: cahu" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"senhaAtual":"123456","novaSenha":"nova@2026"}'; echo
echo "5) login com a nova"; curl -s -X POST $A/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"33333333000191","senha":"nova@2026"}'; echo
echo "6) 123456 nao vale mais"; curl -s -X POST $A/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"33333333000191","senha":"123456"}'; echo
```
Expected: (1) 200 com `"senhaProvisoria":true`; (2) 401; (3) 400 "Escolha uma senha diferente…"; (4) `{"ok":true}`; (5) 200 com `"senhaProvisoria":false`; (6) 401.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts && git commit -m "feat(api): login só por CNPJ/CPF, senhaProvisoria no login e POST /auth/senha"
```

---

### Task 4: Cadastro com email opcional e mensagem para cliente que já veio do Dlinks

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts` (`RegistrarDto.email`)
- Modify: `apps/api/src/auth/auth.service.ts` (`registrar`, linhas 18-82)

**Interfaces:**
- Produces: `409` com body `{ statusCode: 409, message, codigo: 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO' | 'CLIENTE_JA_EXISTE' }` (o app lê `codigo`).

- [ ] **Step 1: DTO**

Em `RegistrarDto`: `@IsOptional() @IsEmail() email?: string;`. Em `AuthService.registrar`, o tipo do parâmetro: `email?: string;`.

- [ ] **Step 2: Lógica de duplicidade e insert**

Substituir o bloco `const dup = ...; if (dup.rowCount) throw ...` por:
```ts
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
            ? 'Você já é cliente CAHU. Entre com seu CNPJ/CPF e a senha inicial 123456.'
            : 'Já existe cadastro para este CNPJ/CPF. Use Entrar.',
          codigo: provisoria ? 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO' : 'CLIENTE_JA_EXISTE',
        });
      }
```
E no insert, trocar `dados.email.toLowerCase()` por `dados.email?.trim().toLowerCase() || null`.

- [ ] **Step 3: Build, reiniciar e verificar**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/api" && npm run build && (pkill -f "dist/main.js" || true) && (node dist/main.js > /tmp/api.log 2>&1 &) && sleep 4
A=http://localhost:3000/v1/auth
echo "1) cadastro sem email"; curl -s -X POST $A/registrar -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"tipo":"CNPJ","documento":"44444444000191","nomeFantasia":"Sem Email","senha":"abc123"}' | head -c 120; echo
echo "2) documento de cliente provisorio (T1)"; curl -s -X POST $A/registrar -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"tipo":"CNPJ","documento":"11111111000191","nomeFantasia":"X","senha":"abc123"}'; echo
echo "3) documento com senha definitiva (T3)"; curl -s -X POST $A/registrar -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"tipo":"CNPJ","documento":"33333333000191","nomeFantasia":"X","senha":"abc123"}'; echo
```
Expected: (1) 201 com `accessToken`; (2) 409 com `"codigo":"CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO"`; (3) 409 com `"codigo":"CLIENTE_JA_EXISTE"`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts && git commit -m "feat(api): cadastro com email opcional e aviso de primeiro acesso para cliente do Dlinks"
```

---

### Task 5: Retaguarda — redefinir senha de acesso

**Files:**
- Modify: `apps/api/src/admin/admin.controller.ts` (após `excluirCliente`, linha ~73)
- Modify: `apps/api/src/admin/admin.service.ts` (após `mudarStatusCliente`, linha ~138)
- Modify: `apps/admin/src/paginas/Clientes.tsx`

**Interfaces:**
- Consumes: `hashSenhaProvisoria` (Task 2); `ReqAdmin`, padrão de auditoria de `admin.service.ts`.
- Produces: `POST /v1/admin/clientes/:id/redefinir-senha` → `{ ok: true }` (só papel `admin`).

- [ ] **Step 1: Service**

Em `admin.service.ts`, após `mudarStatusCliente`:
```ts
  async redefinirSenhaCliente(id: string, usuarioId: string) {
    const { pool } = tenantCtx();
    const r = await pool.query(
      `insert into cliente_credenciais (cliente_id, senha_hash, senha_provisoria)
       select id, $2, true from clientes where id = $1
       on conflict (cliente_id) do update set senha_hash = excluded.senha_hash, senha_provisoria = true
       returning cliente_id`,
      [id, await hashSenhaProvisoria()],
    );
    if (!r.rowCount) throw new NotFoundException('Cliente não encontrado');
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id)
       values ($1,'redefinir_senha','cliente',$2)`,
      [usuarioId, id],
    );
    return { ok: true };
  }
```
Import: `import { hashSenhaProvisoria } from '../auth/senha-provisoria';`

- [ ] **Step 2: Controller**

Em `admin.controller.ts`, após `excluirCliente`:
```ts
  @Post('clientes/:id/redefinir-senha')
  @HttpCode(200)
  redefinirSenha(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    return this.admin.redefinirSenhaCliente(id, req.admin.usuarioId);
  }
```
Garantir que `Post`, `HttpCode` e `ForbiddenException` estão importados de `@nestjs/common` (adicionar se faltar).

- [ ] **Step 3: Botão na retaguarda**

Em `Clientes.tsx`, adicionar a função após `excluir`:
```tsx
  async function redefinirSenha(c: LinhaCliente) {
    if (!confirm(`Redefinir a senha de acesso de ${c.nome_fantasia}? O cliente passa a entrar com o CNPJ/CPF e a senha inicial 123456, e será obrigado a criar uma nova no próximo acesso.`)) return;
    try {
      await api(`/admin/clientes/${c.id}/redefinir-senha`, { method: 'POST' });
      alert(`Senha redefinida. Informe ao cliente: entrar com o CNPJ/CPF e a senha 123456.`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }
```
Na coluna Ações, antes do botão Excluir:
```tsx
                      <button className="btn-mini" onClick={() => redefinirSenha(c)}>Redefinir senha</button>{' '}
```
E na coluna Contato, trocar `{c.email}` por `{c.email ?? '—'}`.

- [ ] **Step 4: Build API + admin e verificar**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/api" && npm run build && (pkill -f "dist/main.js" || true) && (node dist/main.js > /tmp/api.log 2>&1 &) && sleep 4
cd ../admin && npm run build
B=http://localhost:3000/v1
TOK=$(curl -s -X POST $B/admin/auth/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"email":"admin@cahu.com.br","senha":"cahu@2026"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken')
ID=$(PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -tAc "select id from clientes where documento='33333333000191'")
curl -s -X POST $B/admin/clientes/$ID/redefinir-senha -H "X-Tenant: cahu" -H "Authorization: Bearer $TOK"; echo
curl -s -X POST $B/auth/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"33333333000191","senha":"123456"}' | head -c 200; echo
```
Expected: `{"ok":true}`; login com `123456` volta a funcionar com `"senhaProvisoria":true`. Abrir a retaguarda (`npx vite --host` em `apps/admin`) e conferir o botão "Redefinir senha" na lista de clientes.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git add apps/api/src/admin/admin.controller.ts apps/api/src/admin/admin.service.ts apps/admin/src/paginas/Clientes.tsx && git commit -m "feat(admin): redefinir senha de acesso do cliente (volta para 123456 provisória)"
```

---

### Task 6: App — login por CNPJ/CPF e tela obrigatória de nova senha

**Files:**
- Modify: `apps/mobile/lib/core/api_client.dart`
- Modify: `apps/mobile/lib/features/auth/login_screen.dart`
- Create: `apps/mobile/lib/features/auth/nova_senha_screen.dart`

**Interfaces:**
- Consumes: login devolve `senhaProvisoria` (Task 3); `POST /auth/senha` (Task 3).
- Produces: `ApiClient.instance.senhaProvisoria` (bool, persistido em SharedPreferences); `NovaSenhaScreen` (rota que substitui a atual e, ao concluir, chama `aoConcluir`).

- [ ] **Step 1: `ApiClient` guarda `senhaProvisoria`**

Em `api_client.dart`, adicionar campo e API:
```dart
  bool _senhaProvisoria = false;
  bool get senhaProvisoria => _senhaProvisoria;

  Future<void> marcarSenhaProvisoria(bool valor) async {
    _senhaProvisoria = valor;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('senhaProvisoria', valor);
    notifyListeners();
  }
```
Em `carregarSessao`, após ler os tokens: `_senhaProvisoria = prefs.getBool('senhaProvisoria') ?? false;`. Em `sair`, após remover os tokens: `_senhaProvisoria = false; await prefs.remove('senhaProvisoria');`.

- [ ] **Step 2: Tela de nova senha**

`apps/mobile/lib/features/auth/nova_senha_screen.dart`:
```dart
import 'package:flutter/material.dart';

import '../../core/api_client.dart';

/// Primeiro acesso: o cliente entrou com a senha inicial (123456) e precisa
/// criar a dele antes de usar o app. Não dá pra voltar sem concluir.
class NovaSenhaScreen extends StatefulWidget {
  const NovaSenhaScreen({super.key, required this.aoConcluir});
  final VoidCallback aoConcluir;

  @override
  State<NovaSenhaScreen> createState() => _NovaSenhaScreenState();
}

class _NovaSenhaScreenState extends State<NovaSenhaScreen> {
  final _form = GlobalKey<FormState>();
  final _nova = TextEditingController();
  final _confirma = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _nova.dispose();
    _confirma.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ApiClient.instance.post('/auth/senha', {
        'senhaAtual': '123456',
        'novaSenha': _nova.text,
      });
      await ApiClient.instance.marcarSenhaProvisoria(false);
      if (!mounted) return;
      widget.aoConcluir();
    } on ApiException catch (e) {
      setState(() => _erro = e.message);
    } catch (_) {
      setState(() => _erro = 'Sem conexão — tente novamente');
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(title: const Text('Crie sua nova senha'), automaticallyImplyLeading: false),
        body: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Text(
                'Você entrou com a senha inicial. Por segurança, crie agora a sua senha para os próximos acessos.',
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _nova,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Nova senha (mín. 6 caracteres)'),
                validator: (v) {
                  if ((v ?? '').length < 6) return 'Mínimo de 6 caracteres';
                  if (v == '123456') return 'Escolha uma senha diferente da inicial';
                  return null;
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _confirma,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Confirme a nova senha'),
                validator: (v) => v == _nova.text ? null : 'As senhas não conferem',
                onFieldSubmitted: (_) => _salvar(),
              ),
              if (_erro != null) ...[
                const SizedBox(height: 14),
                Text(_erro!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 22),
              FilledButton(
                onPressed: _enviando ? null : _salvar,
                child: _enviando
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                    : const Text('Salvar e continuar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Login screen**

Em `login_screen.dart`:
- Import: `import 'nova_senha_screen.dart';`
- Docblock: `/// Login do cliente da distribuidora (CNPJ/CPF + senha).`
- Campo identificador:
```dart
                  TextField(
                    controller: _identificador,
                    decoration: const InputDecoration(labelText: 'CNPJ ou CPF'),
                    keyboardType: TextInputType.number,
                  ),
```
- Em `_entrar`, substituir do `salvarTokens` até o fim do `else`:
```dart
      await ApiClient.instance.salvarTokens(r['accessToken'], r['refreshToken']);
      await ApiClient.instance.marcarSenhaProvisoria(r['senhaProvisoria'] == true);
      if (!mounted) return;
      void seguir() {
        if (widget.retornarAoLogar) {
          Navigator.of(context).pop(true);
        } else {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (_) => const HomeShell()),
          );
        }
      }
      if (r['senhaProvisoria'] == true) {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => NovaSenhaScreen(aoConcluir: () => Navigator.of(context).pop())),
        );
        if (!mounted) return;
      }
      seguir();
```
- Enviar só dígitos: `'identificador': _identificador.text.replaceAll(RegExp(r'\D'), ''),`
- Diálogo "Esqueci minha senha": texto `'Peça à distribuidora para redefinir sua senha. Você entra com o CNPJ/CPF e a senha inicial 123456 e cria uma nova.'`

- [ ] **Step 4: Sessão já aberta com senha provisória (app fechado no meio)**

Em `apps/mobile/lib/main.dart`, no ponto onde o boot decide `HomeShell` vs `CepScreen` após `carregarSessao()`: se `ApiClient.instance.logado && ApiClient.instance.senhaProvisoria`, abrir `NovaSenhaScreen(aoConcluir: ...)` que ao concluir faz `pushReplacement` para `HomeShell`. Ler o `main.dart` atual antes de editar; a mudança é uma condição a mais na decisão de tela inicial, sem mudar o resto do boot.

- [ ] **Step 5: `flutter analyze`**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/mobile" && C:/dev/flutter/bin/flutter analyze
```
Expected: `No issues found!`

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git add apps/mobile/lib/core/api_client.dart apps/mobile/lib/features/auth/login_screen.dart apps/mobile/lib/features/auth/nova_senha_screen.dart apps/mobile/lib/main.dart && git commit -m "feat(app): login por CNPJ/CPF e tela obrigatória de nova senha no primeiro acesso"
```

---

### Task 7: App — cadastro com email opcional e aviso de primeiro acesso

**Files:**
- Modify: `apps/mobile/lib/core/api_client.dart` (`ApiException` ganha `codigo`)
- Modify: `apps/mobile/lib/features/auth/cadastro_screen.dart`

**Interfaces:**
- Consumes: `409` com `codigo` (Task 4).

- [ ] **Step 1: `ApiException.codigo`**

```dart
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.codigo});
  final int statusCode;
  final String message;
  final String? codigo;
  @override
  String toString() => message;
}
```
Em `_send`, ao lançar: `throw ApiException(res.statusCode, msg, codigo: decoded is Map ? decoded['codigo'] as String? : null);`

- [ ] **Step 2: Cadastro**

Em `cadastro_screen.dart`:
- Campo email: label `'E-mail (opcional)'` e validator `(v) => (v ?? '').trim().isEmpty || ((v ?? '').contains('@') && (v ?? '').contains('.')) ? null : 'E-mail inválido'`.
- Envio: `if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),`
- No `on ApiException catch (e)`, antes do snackbar:
```dart
      if (e.codigo == 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO' && mounted) {
        final irLogin = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Você já é cliente'),
            content: Text(e.message),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Fechar')),
              FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Ir para Entrar')),
            ],
          ),
        );
        if (irLogin == true && mounted) Navigator.of(context).pop(false);
        return;
      }
```
(`pop(false)` volta para a tela anterior — a `LoginScreen` ou o gate "Entrar ou criar" — sem sinalizar login concluído.)

- [ ] **Step 3: `flutter analyze` e commit**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/mobile" && C:/dev/flutter/bin/flutter analyze && cd ../.. && git add apps/mobile/lib/core/api_client.dart apps/mobile/lib/features/auth/cadastro_screen.dart && git commit -m "feat(app): cadastro com email opcional e aviso de primeiro acesso"
```

---

### Task 8: Teste no aparelho, docs e deploy

**Files:**
- Modify: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\01 - Documentação\03-INTEGRACAO-DLINKS-HANDOFF.html` (linha da tabela `/clientes`, campo `email`) + regenerar `.pdf`
- Modify: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\01 - Documentação\02-INTEGRACAO-ERP.md` (seção 8)

- [ ] **Step 1: APK e teste no celular**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/apps/mobile" && C:/dev/flutter/bin/flutter build apk --release --dart-define=TENANT=cahu --dart-define=API_URL=https://cahudelivery.duckdns.org/v1 --dart-define=APP_NOME="CAHU Delivery"
```
Instalar `build/app/outputs/flutter-apk/app-release.apk` no aparelho do Tiago (após o deploy do Step 4). Roteiro: entrar com um CNPJ do Dlinks + `123456` → tela "Crie sua nova senha" aparece e não deixa voltar → salvar → home; sair e entrar com a nova senha → home direto; "Criar minha conta" sem email → funciona; "Criar minha conta" com CNPJ do Dlinks → diálogo "Você já é cliente" → "Ir para Entrar".

- [ ] **Step 2: Documentação**

Na tabela `/clientes` do HTML, trocar a descrição do `email` por `E-mail de contato (opcional; pode se repetir entre clientes)`. Regenerar o PDF:
```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/01 - Documentação" && "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$(pwd -W)/03-INTEGRACAO-DLINKS-HANDOFF.pdf" "file:///$(pwd -W)/03-INTEGRACAO-DLINKS-HANDOFF.html"
```
Em `02-INTEGRACAO-ERP.md`, seção 8, acrescentar: `**Login (10/09/2026):** cliente entra só com CNPJ/CPF. Cliente vindo do Dlinks recebe senha inicial 123456 (provisória) e é obrigado a trocar no primeiro acesso; a retaguarda pode redefinir para 123456. Email é contato opcional, pode repetir.`

- [ ] **Step 3: Push**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce" && git push origin main
```

- [ ] **Step 4: Deploy em produção (ordem importa: migração antes do restart)**

1. Tiago aplica a migração 019 no servidor, em prompt de Administrador (senha do `postgres` na config do serviço FluxoAPI):
   `C:\PostgreSQL\16\bin\psql.exe -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f C:\cahudelivery\infra\sql\tenant\019_login_por_documento.sql`
   (o arquivo chega pelo `git pull` do passo 2 — fazer o pull antes).
2. Via SSH:
```bash
ssh -i ~/.ssh/claude_254 claude-ssh@192.168.2.254 "cd /d C:\cahudelivery && git pull --ff-only && cd apps\api && npm run build && cd ..\admin && npm run build && type nul > C:\cahudelivery\restart-api.flag"
```
3. Após ~60s, verificar:
```bash
curl -s -X POST https://cahudelivery.duckdns.org/v1/auth/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"identificador":"21425302000181","senha":"123456"}' | head -c 160
```
Expected: 200 com `"senhaProvisoria":true` (cliente 828 do Dlinks). Não trocar a senha desse cliente no teste — é cliente real.

- [ ] **Step 5: Limpar dados de teste locais**

```bash
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -c "delete from cliente_credenciais where cliente_id in (select id from clientes where documento in ('11111111000191','22222222000191','33333333000191','44444444000191'))" -c "delete from cliente_enderecos where cliente_id in (select id from clientes where documento in ('11111111000191','22222222000191','33333333000191','44444444000191'))" -c "delete from clientes where documento in ('11111111000191','22222222000191','33333333000191','44444444000191')"
```

---

## Self-review

- **Cobertura da spec:** migração (T1); sync grava email real e credencial provisória (T2); login só por documento + `senhaProvisoria` + `POST /auth/senha` rejeitando `123456` (T3); cadastro email opcional + 409 com códigos (T4); retaguarda redefinir + `—` para email nulo (T5); app login/nova senha/boot com sessão provisória (T6); app cadastro (T7); docs, PDF, deploy com migração antes do restart (T8). Busca da retaguarda por email já tolera nulo (`ilike` sobre null é falso) — sem tarefa.
- **Placeholders:** `HASH_AQUI` no SQL é preenchido pelo comando do Step 1 da Task 1 (instrução exata). Step 4 da Task 6 pede leitura do `main.dart` antes de editar porque a estrutura do boot não está neste plano — a mudança está descrita (condição extra) e verificada pelo `flutter analyze` + teste no aparelho.
- **Consistência de nomes:** `SENHA_PROVISORIA`/`hashSenhaProvisoria` (T2) usados em T3 e T5; `senhaProvisoria` (camelCase) na resposta da API e no `ApiClient`; `codigo` no 409 (T4) lido em `ApiException.codigo` (T7); `NovaSenhaScreen(aoConcluir:)` (T6) usado em login e boot.
