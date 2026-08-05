# Indica CAHU (programa de indicação) — Design

## Contexto

9º item do benchmark com o concorrente Praso: "Indica Praso" (ganhe R$150 por indicação). O
Tiago decidiu fazer a versão do CAHU Delivery com **R$100**, creditados na **Carteira** (saldo)
de quem indicou — reaproveita o mecanismo entregue no plano da Carteira (`carteira_movimentos`,
Tasks 1-7, 04/08/2026). Dos outros dois itens do benchmark discutidos na mesma sessão: "foto do
estoque" foi descartado (Tiago não quer expor estoque ao cliente) e a nav inferior do app
continua como está hoje (decisão consciente de não copiar a estrutura do Praso).

## Decisões confirmadas com o Tiago

- Valor da recompensa: **R$100**, fixo (não configurável pela retaguarda nesta v1).
- Gatilho de liberação: **primeiro pedido do indicado chegar a FATURADO** — não no cadastro, não
  na aprovação de cadastro. Evita indicação fake sem compra real.
- Link de convite **sem deep link de verdade** — o app ainda não está em loja oficial (Play/App
  Store), só é instalado hoje via APK baixado por link. O link de indicação abre uma página web
  simples mostrando o código, não tenta abrir o app automaticamente.
- Retaguarda precisa de uma **fila dedicada** (não só o motivo do lançamento na Carteira) —
  listando todas as indicações com status.

## Arquitetura

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

Sem tabela nova — três colunas em `clientes` já cobrem o ciclo de vida completo de uma
indicação (pedido → creditado):

```sql
alter table clientes add column codigo_indicacao text unique;
alter table clientes add column indicado_por_cliente_id uuid references clientes(id);
alter table clientes add column indicacao_creditada_em timestamptz;
```

`codigo_indicacao` é gerado no cadastro (Node, não trigger SQL — mesmo padrão de código já usado
no projeto, tudo em `pool.query` cru). `indicado_por_cliente_id` é gravado uma vez, no cadastro do
indicado, e nunca muda depois. `indicacao_creditada_em` começa nulo e é preenchido quando o
crédito é dado — funciona como o "lock" que garante que o crédito só dispara uma vez, não importa
quantos pedidos o indicado fizer depois.

### 2. Geração do código (`apps/api/src/auth/auth.service.ts`, dentro de `registrar`)

Antes do `insert into clientes`, gera um código de 6 caracteres (`A-Z0-9`, maiúsculo) e confirma
unicidade com um `select` — em caso de colisão (extremamente raro), gera de novo (loop simples,
máximo 5 tentativas). Grava junto no mesmo `insert` que já existe.

### 3. Cadastro aceita código de indicação (`apps/api/src/auth/auth.controller.ts` +
`auth.service.ts`)

`RegistrarDto` ganha `@IsOptional() @IsString() codigoIndicacao?: string`. Em `registrar`, se
`codigoIndicacao` vier preenchido:

1. `select id from clientes where codigo_indicacao = $1` (case-insensitive, `upper()` nos dois
   lados).
2. Não encontrado → `BadRequestException('Código de indicação inválido')` (400 — erro explícito,
   não ignora silenciosamente; campo é opcional, mas se preenchido tem que ser válido).
3. Encontrado → grava `indicado_por_cliente_id` no `insert` do novo cliente, dentro da mesma
   transação que já existe.

Auto-indicação é estruturalmente impossível: o cliente que está se cadastrando ainda não existe
no banco no momento em que digita o código, então não tem como ter o próprio código ainda.

### 4. Crédito automático (`apps/api/src/orders/outbox.worker.ts`, dentro de `sincronizarStatus`)

Ponto de extensão natural: esse método já roda a cada 30s, já compara `st.status !== p.status` e
já atualiza o pedido quando muda. Adiciona, só na transição pra `FATURADO`:

```typescript
if (st.status !== p.status) {
  await pool.query(`update pedidos set status = $2 where id = $1`, [p.id, st.status]);
  await pool.query(`insert into pedido_eventos ...`); // já existe

  if (st.status === 'FATURADO') {
    const cli = await pool.query(
      `select c.id as indicado_id, c.nome_fantasia as indicado_nome, c.indicado_por_cliente_id
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.id = $1 and c.indicado_por_cliente_id is not null and c.indicacao_creditada_em is null`,
      [p.id],
    );
    if (cli.rows[0]) {
      const { indicado_id, indicado_nome, indicado_por_cliente_id } = cli.rows[0];
      await pool.query(
        `insert into carteira_movimentos (cliente_id, valor, motivo) values ($1, 100, $2)`,
        [indicado_por_cliente_id, `Indicação: ${indicado_nome}`],
      );
      await pool.query(`update clientes set indicacao_creditada_em = now() where id = $1`, [indicado_id]);
    }
  }
}
```

(Pseudocódigo pra ilustrar a lógica — a implementação de verdade ajusta a query pro shape exato
de `sincronizarStatus`, que hoje itera vários pedidos de vários tenants num loop.)

### 5. Backend — cliente consulta suas indicações (`apps/api/src/profile/profile.controller.ts`)

- `GET /v1/indicacoes` → `{ codigo: string, link: string, indicacoes: Array<{nome, status:
  'pendente'|'creditado', criado_em, creditado_em}> }`. `codigo` vem de `clientes.codigo_indicacao`
  do próprio cliente logado; `link` é montado no backend (`PUBLIC_URL + '/indica/' + codigo`) pra
  não hard-codar domínio no app; `indicacoes` é o `select` dos clientes onde
  `indicado_por_cliente_id = $1` (nome + status derivado de `indicacao_creditada_em`).

### 6. Backend — admin, fila de indicações (`apps/api/src/admin/admin.controller.ts` +
`admin.service.ts`)

- `GET /admin/indicacoes` (paginado, mesmo padrão de `credito-solicitacoes`) → self-join em
  `clientes` (indicador × indicado via `indicado_por_cliente_id`), retornando indicador (nome,
  documento), indicado (nome, documento), status, `criado_em` (data do cadastro do indicado),
  `creditado_em`. Só leitura — o crédito é sempre automático (worker), não tem ação manual de
  "aprovar" aqui.

### 7. App Flutter — tela "Indique e ganhe"
(`apps/mobile/lib/features/profile/indicacoes_screen.dart`)

Mesmo esqueleto de `CreditoScreen`/`CarteiraScreen`: `GET /indicacoes` no `initState`. Conteúdo:
card com o código em destaque + botão "Copiar link de convite" (usa `Clipboard.setData` com o
`link` que já vem pronto da API, mesmo padrão que outras telas já usam pra copiar PIX
copia-e-cola) + lista de indicações (nome + selo "Aguardando primeiro pedido" ou "R$100
creditado em DD/MM", mesmo estilo de selo colorido já usado no card de produto). `EstadoVazio` se
a lista vier vazia ("Indique um mercado parceiro e ganhe R$100 quando ele fizer o primeiro
pedido"). Item de menu em `PerfilScreen`, entre "Carteira" e "Sobre o app".

### 8. Cadastro — campo opcional (`apps/mobile/lib/features/auth/...` tela de cadastro existente)

Campo de texto opcional "Código de indicação (opcional)" no formulário de cadastro. Envia
`codigoIndicacao` no `POST /auth/registrar` só se preenchido. Erro 400 do backend (código
inválido) aparece como mensagem de erro no campo, mesmo padrão de validação já usado no resto do
formulário.

### 9. Página pública do link (`apps/admin/src/App.tsx`, rota nova sem autenticação)

Rota `/indica/:codigo` **fora** do `AdminGuard`/redirecionamento de login (mesmo nível da rota
`/login`, mas sem formulário — só leitura da URL). Componente novo `IndicaLanding.tsx`: mostra o
código grande (pego direto do parâmetro da URL, sem chamar API — mais simples e não vaza quem é o
dono do código) + o texto "Baixe o app CAHU Delivery e digite esse código no cadastro. Assim que
seu primeiro pedido for faturado, quem te indicou ganha R$100 de saldo." Sem link de download do
APK nesta v1 — ver "Fora de escopo" abaixo (a distribuição do app fora do ambiente de teste ainda
não está decidida; a página nasce só com o texto acima até isso existir).

### 10. Retaguarda — página `Indicacoes.tsx` (`apps/admin/src/paginas/Indicacoes.tsx`)

Tabela simples (mesmo padrão de `SolicitacoesCredito.tsx`): colunas Indicador, Indicado, Status
(badge colorido: cinza "Aguardando" / verde "Creditado"), Data do cadastro, Data do crédito.
Sem paginação client-side complexa — reaproveita o padrão de página+limite já usado em
`Pedidos.tsx`/`Clientes.tsx`. Rota `/indicacoes` e link `🎁 Indique e Ganhe` no menu lateral,
entre "Crédito" e "Carteira".

## Fora de escopo

- Configurar o valor da recompensa pela retaguarda — R$100 fixo no código nesta v1 (mudar depois
  é uma linha, mas não é prioridade agora).
- Deep link de verdade (App Links/Universal Links) — só faz sentido quando o app estiver
  publicado numa loja oficial com domínio verificado.
- Link de download do APK de produção assinado na página pública — depende de decisão futura de
  distribuição do app fora do escopo desta feature; a página landing pode nascer com um texto
  genérico ("fale com seu contato na CAHU pra receber o link") até isso existir.
- Detecção de fraude (mesma pessoa se cadastrando duas vezes pra farmar o bônus) — não construído
  nesta v1, mesmo espírito de "fora de escopo" já usado em outras features do projeto.
- Expiração de indicação pendente (indicado nunca fatura) — fica pendente pra sempre, sem limpeza
  automática.
- Aplicar um código de indicação depois do cadastro já feito — só é aceito no momento do
  cadastro.
- Notificação push/inbox quando o crédito é dado — cliente só vê ao abrir a tela "Indique e
  ganhe" ou a Carteira (mesmo padrão de outras features, sem push por enquanto).
