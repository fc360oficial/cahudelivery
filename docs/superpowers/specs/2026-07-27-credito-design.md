# Crédito (placeholder) na Conta — Design

## Contexto

6º item do benchmark com o concorrente Praso: prints confirmados pelo Tiago mostram uma tela
"Crédito" com velocímetro/gauge, título "Crédito para boleto a prazo indisponível", texto
explicativo e botão "Solicitar análise de crédito". Não existe dado real de limite de crédito
hoje — isso só chega na Fase 4 (integração Dlinks, que vai empurrar "títulos em aberto" = limite
de crédito real do cliente no ERP). Esta feature é a versão manual/placeholder: o cliente pede
análise, a distribuidora vê a fila na retaguarda e resolve por fora do sistema (telefone, olhar
o cadastro no Dlinks manualmente etc.) — sem cálculo automático de limite.

## Decisões confirmadas com o Tiago

- Botão "Solicitar análise de crédito" grava a solicitação no banco (não é só um diálogo de
  aviso, como o "Esqueci minha senha" do login).
- A retaguarda ganha uma tela pra ver a fila de solicitações agora, não depois.
- Depois de solicitar, a tela do app muda pra "Sua solicitação está em análise" e o botão some —
  evita solicitação duplicada. Um cliente só pode ter uma solicitação `pendente` por vez.

## Pendência registrada (fora de escopo desta spec)

Tiago levantou a possibilidade de consultar um bureau de crédito (Serasa Experian, Boa Vista
SCPC, SPC Brasil, Quod) automaticamente na análise — isso resolveria o caso que a Fase 4 não
cobre (cliente novo, sem histórico de compra na CAHU). Não sabe ainda se a CAHU já tem contrato
com algum desses serviços — vai confirmar. **Não faz parte desta implementação.** Quando a
resposta vier, isso plugaria como uma etapa a mais no fluxo de atendimento do admin (consultar
o bureau antes de marcar como atendida), sem mudar o fluxo do lado do cliente.

## Arquitetura

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

```sql
create table solicitacoes_credito (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  status text not null default 'pendente' check (status in ('pendente','atendida')),
  solicitado_em timestamptz not null default now(),
  atendido_em timestamptz,
  atendido_por uuid references usuarios_admin(id)
);

create unique index solicitacoes_credito_pendente_unica
  on solicitacoes_credito (cliente_id)
  where status = 'pendente';
```

O índice único parcial (`where status = 'pendente'`) é o que garante "um cliente só pode ter uma
solicitação pendente por vez" no próprio banco — não depende só da lógica da aplicação.

### 2. Backend — cliente (`apps/api/src/profile/profile.controller.ts`, mesmo padrão de
`favoritos`: sem service separado, SQL cru direto no controller)

- `GET /v1/credito` → `select 1 from solicitacoes_credito where cliente_id=$1 and status='pendente'`
  → `{ pendente: boolean }`.
- `POST /v1/credito/solicitar` → `insert ... on conflict do nothing` (aproveitando o índice único
  parcial acima) → sempre retorna `{ pendente: true }`, tenha criado agora ou já existisse uma.

### 3. Backend — admin (`apps/api/src/admin/admin.controller.ts` +
`apps/api/src/admin/admin.service.ts`, mesmo padrão de `clientes`/`mudarStatusCliente`)

- `GET /admin/credito-solicitacoes?status=pendente` → lista com nome/documento do cliente e
  `solicitado_em`, join com `clientes`.
- `PATCH /admin/credito-solicitacoes/:id/atender` → `update ... set status='atendida',
  atendido_em=now(), atendido_por=$2 where id=$1 and status='pendente'`, mais um insert em
  `auditoria` (`acao: 'atender_credito'`), mesmo padrão de `mudarStatusCliente`.

### 4. App Flutter — tela nova `CreditoScreen`
(`apps/mobile/lib/features/profile/credito_screen.dart`)

Busca `GET /credito` no `initState`. Dois estados (sem esqueleto/skeleton — é uma tela estática
de baixo tráfego, só loading spinner simples enquanto carrega):

- **Sem pendência** (`pendente: false`): ícone de velocímetro cinza (`Icons.speed` ou
  equivalente — cor cinza, não é gráfico de verdade), título "Crédito para boleto a prazo
  indisponível", texto "No momento não conseguimos conceder crédito para esta conta. Solicite
  uma nova análise para reavaliarmos seu acesso.", botão "Solicitar análise de crédito" que
  chama o POST e recarrega o estado (mostrando feedback de "enviando" durante a chamada).
- **Com pendência** (`pendente: true`): mesmo ícone/título, texto trocado pra "Sua solicitação
  está em análise. A distribuidora vai avaliar seu cadastro em breve." — sem botão.

### 5. Menu em Perfil (`apps/mobile/lib/features/profile/perfil_screen.dart`)

Novo item `_opcao(Icons.speed_outlined, 'Crédito', ...)`, entre "Notas fiscais" e "Sobre o app"
(mesmo Card de opções, mesmo padrão de navegação `Navigator.push`).

### 6. Retaguarda — página nova `SolicitacoesCredito.tsx`
(`apps/admin/src/paginas/SolicitacoesCredito.tsx`)

Mesmo esqueleto de `Notificacoes.tsx` (tabela + estado vazio), sem formulário de envio. Colunas:
cliente (nome + documento), data da solicitação, botão "Marcar como atendida" (some da lista ao
clicar, mesmo padrão do botão "Aprovar" em `Clientes.tsx`). Item novo no menu lateral
(`Layout.tsx`, `LINKS`) e rota nova (`App.tsx`, `ROTAS`), posicionados entre "Clientes" e
"Produtos".

## Fora de escopo

- Cálculo automático de limite de crédito — isso só existe quando a Fase 4 (Dlinks) estiver
  pronta.
- Consulta a bureau de crédito externo (Serasa/Boa Vista/SPC/Quod) — ver seção "Pendência
  registrada" acima.
- Notificar o cliente (push/inbox) quando a solicitação for atendida — a distribuidora resolve
  por fora do sistema (telefone) por enquanto; o cliente só vê a mudança de estado se abrir a
  tela de novo.
- Histórico de solicitações atendidas na retaguarda (a tela só lista pendentes) — se precisar de
  auditoria completa depois, a tabela `auditoria` já guarda o registro, só falta uma UI pra ela.