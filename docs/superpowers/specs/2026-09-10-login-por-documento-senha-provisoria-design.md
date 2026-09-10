# Login por CNPJ/CPF, email opcional e senha provisória para clientes do Dlinks

**Data:** 2026-09-10
**Status:** aprovado pelo Tiago (brainstorming em sessão)

## Problema

1. Clientes sincronizados do Dlinks (`POST /integracoes/dlinks/clientes`) chegam **sem credencial** — nenhum dos 125 consegue entrar no app.
2. `clientes.email` é `not null unique` porque é o login. No ERP vários clientes compartilham o mesmo email (contador, dono de várias lojas); hoje isso vira placeholder `<documento>@sem-email.dlinks.local` ou falha de sincronização.
3. O contrato enviado ao Dlinks documenta `email` como opcional.

## Decisão

- **Identidade do cliente é o CNPJ/CPF** (`clientes.documento`, já único). Login só por documento.
- **Email vira contato**: opcional e pode repetir.
- **Cliente vindo do Dlinks entra com a senha inicial `123456`** e é obrigado a criar uma nova senha no primeiro login.
- Retaguarda pode **redefinir a senha de acesso** de um cliente (volta para `123456` provisória).

Risco aceito: até o cliente fazer o primeiro acesso, quem souber o CNPJ entra com `123456`. A CAHU orienta os clientes a fazerem o primeiro acesso logo; após a troca, `123456` deixa de valer. Verificação por SMS/WhatsApp fica fora de escopo.

## Banco (migração tenant `019_login_por_documento.sql`)

```sql
alter table clientes alter column email drop not null;
alter table clientes drop constraint clientes_email_key;
alter table cliente_credenciais add column senha_provisoria boolean not null default false;

-- placeholders viram "sem email"
update clientes set email = null where email like '%@sem-email.dlinks.local';

-- todo cliente sem credencial ganha a senha inicial provisória
insert into cliente_credenciais (cliente_id, senha_hash, senha_provisoria)
select c.id, '<hash argon2 de 123456>', true
  from clientes c
 where not exists (select 1 from cliente_credenciais cc where cc.cliente_id = c.id);
```

O hash do `123456` é gerado uma vez pelo script de migração (argon2 não roda em SQL puro): a migração é aplicada por um script Node em `infra/scripts/` que gera o hash e executa o SQL, ou o SQL recebe o hash por substituição. O plano decide o mecanismo; o efeito é o acima.

Espelhar em `11 - SQL/` (fora do repo) como as demais migrações.

## API

### Sync Dlinks — `DlinksSyncService.syncClientes`
- Grava `email` exatamente como vier (`email` ou `Email`), repetido ou não; sem placeholder. Ausente → `null`. Nunca sobrescreve email existente com `null`.
- Cliente **novo** (insert): cria `cliente_credenciais` com hash de `123456` e `senha_provisoria = true`, na mesma transação.
- Cliente existente: não toca em credencial.
- Remove a checagem de "email já usado por outro cliente" e o contador de duplicados no log.

### Login — `AuthService.login`
- `identificador` é tratado só como documento (`replace(/\D/g,'')`); `where c.documento = $1`. Email deixa de ser aceito (seria ambíguo).
- Resposta ganha `senhaProvisoria: boolean` (lido de `cliente_credenciais`).

### Nova senha — `POST /v1/auth/senha` (autenticado como cliente)
- Body: `{ senhaAtual, novaSenha }`. Valida `senhaAtual` contra o hash; `novaSenha` com `MinLength(6)` e **diferente de `123456`**.
- Atualiza `senha_hash` e zera `senha_provisoria`.
- Serve tanto para o primeiro acesso quanto para troca voluntária (o app só expõe a troca voluntária se já existir tela de Perfil para isso; não é obrigatório neste escopo).

### Cadastro — `AuthService.registrar` / `RegistrarDto`
- `email` opcional (`@IsOptional() @IsEmail()`); não valida unicidade de email.
- Se `documento` já existe:
  - com credencial provisória → `409` com mensagem `"Você já é cliente CAHU. Entre com seu CNPJ/CPF e a senha inicial 123456."` (código `CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO`);
  - com credencial definitiva → `409` `"Já existe cadastro para este CNPJ/CPF. Use Entrar."`.
- Cadastro pelo app continua criando credencial definitiva (`senha_provisoria = false`).

### Retaguarda — `POST /admin/clientes/:id/redefinir-senha`
- Só `admin`. Regrava `senha_hash = hash(123456)`, `senha_provisoria = true`. Auditado como as outras mutações.
- Front: botão "Redefinir senha de acesso" na linha do cliente (`Clientes.tsx`), com confirmação.

### Outros pontos de contato com `email`
- `admin` lista/busca de clientes: já tolera `null` na busca (`ilike` sobre null é falso); exibir "—" quando nulo.
- Notificações/inbox que usem email como destinatário: nenhuma envia email hoje (só inbox interna); nada a fazer.
- `Indica CAHU`, carteira, pedidos: não dependem de email.

## App (Flutter)

- `login_screen.dart`: campo "CNPJ ou CPF" com máscara/teclado numérico; envia `identificador` só com dígitos. Texto do "Esqueci minha senha": "Peça à CAHU para redefinir sua senha. Você entra com a senha inicial 123456 e cria uma nova."
- Após login com `senhaProvisoria == true`: navega para `NovaSenhaScreen` (rota sem voltar): campos nova senha + confirmação; chama `POST /auth/senha` com `senhaAtual = "123456"`; ao concluir, segue o fluxo normal (destino original: home ou checkout).
- `cadastro_screen.dart`: email opcional (label "E-mail (opcional)", validação só se preenchido). Erro `CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO` mostra diálogo com botão "Ir para Entrar".
- `ApiClient`: guarda `senhaProvisoria` da resposta do login; expõe para o gate do checkout também (login feito no gate deve levar à `NovaSenhaScreen` antes de voltar ao checkout).

## Documentação

- `03-INTEGRACAO-DLINKS-HANDOFF.html/.pdf`: `email` continua "Opcional"; retirar a frase sobre "poderá informá-lo no primeiro acesso"; nada mais muda pro Dlinks.
- `02-INTEGRACAO-ERP.md`: registrar a decisão (login por documento, senha inicial 123456).

## Testes (evidência real antes de dar por pronto)

API, com curl contra ambiente local:
1. Sync de cliente novo sem email → `email null`, credencial provisória criada.
2. Sync de dois clientes com o mesmo email → ambos gravados com o email real.
3. Login com documento + `123456` → 200 com `senhaProvisoria: true`; login por email → 401.
4. `POST /auth/senha` com `novaSenha = 123456` → 400; com senha válida → 200; login com a nova → `senhaProvisoria: false`; login com `123456` → 401.
5. Cadastro pelo app com documento de cliente provisório → 409 `CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO`.
6. Redefinir senha na retaguarda → login com `123456` volta a funcionar com `senhaProvisoria: true`.

App: `flutter analyze` limpo; fluxo de primeiro acesso testado em aparelho real (login → nova senha → home), e cadastro sem email.

## Fora de escopo

Verificação por SMS/WhatsApp; login por email; recuperação de senha self-service; troca de senha voluntária no Perfil (pode reaproveitar `POST /auth/senha` depois).
