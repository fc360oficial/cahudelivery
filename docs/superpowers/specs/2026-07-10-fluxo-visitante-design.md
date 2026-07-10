# Fluxo visitante + carrinho anônimo + identidade amarela — CAHU Delivery

Data: 2026-07-10 · Status: aprovado pelo Tiago

## Problema

O app exigia login antes de qualquer navegação — padrão de app gerencial, errado
para delivery. O cliente precisa ver produtos e montar carrinho sem conta;
login/cadastro só no fechamento do pedido.

## Fluxo aprovado

```
Splash (tema remoto + garante deviceId local)
  └─ 1ª vez → Tela de CEP (ViaCEP mostra cidade/bairro; "Confirmar" ou "Pular por agora")
  └─ HomeShell (5 abas) SEM login
       ├─ Início/Categorias/Produto: já funcionam sem token (OptionalAuthGuard)
       ├─ Carrinho: visitante usa carrinho anônimo por dispositivo
       │    └─ "Finalizar pedido" sem login → tela "Entrar ou criar conta"
       │         → autenticou → carrinho reivindicado → Checkout direto
       ├─ Pedidos (visitante): convite "Entre para ver seus pedidos" [Entrar][Criar conta]
       └─ Perfil (visitante): convite equivalente
```

Decisões do Tiago: carrinho anônimo **no backend** (não local); abas Pedidos/Perfil
mostram **tela de convite** (não modal); CEP **pode pular**; gate do checkout é
**tela dedicada** (não bottom sheet).

## Backend

1. **Migração `11 - SQL/tenant/002_carrinho_anonimo.sql`** (aplicar em `fluxo_t_cahu`):
   - `carrinhos.cliente_id` vira opcional (`drop not null`);
   - nova coluna `device_id text`;
   - check: exatamente um de (`cliente_id`, `device_id`) preenchido;
   - únicos parciais em `cliente_id` e `device_id`.
2. **Header `X-Device-Id`** (UUID gerado pelo app): endpoints do carrinho
   (`GET /carrinho`, `PUT /carrinho/itens`, `DELETE /carrinho/itens/:produtoId`)
   passam de `JwtAuthGuard` para `OptionalAuthGuard`; com token usam o carrinho
   do cliente, sem token usam o do device (400 se nem token nem header).
3. **Reivindicação**: `POST /auth/login` e `POST /auth/registrar` leem
   `X-Device-Id`; ao autenticar, mesclam o carrinho do device no do cliente
   (item duplicado: mantém a MAIOR quantidade) e apagam o carrinho anônimo.
4. **Sem mudança**: `POST /pedidos`, pedidos, perfil, endereços continuam JWT.

## App (Flutter, apps/mobile)

- `ApiClient`: gera/persiste `deviceId` (uuid) e envia `X-Device-Id` sempre.
- **Splash**: não decide mais por login; decide por "CEP já visto?" →
  CepScreen ou HomeShell. Logo direto sobre a cor do tenant (sem cartão branco).
- **CepScreen** (`features/onboarding/cep_screen.dart`): campo CEP, consulta
  ViaCEP exibindo "Cidade/UF · Bairro", botões Confirmar e "Pular por agora".
  Salva CEP localmente (uso futuro: sugestão de endereço e validação de área —
  pergunta 6 do ESCOPO ainda aberta com a CAHU).
- **CarrinhoStore**: remove o `if (!logado) return` — carrega sempre.
- **Gate do checkout** (`features/auth/entrar_ou_criar_screen.dart`): logo no
  topo, botões "Já tenho conta" → LoginScreen e "Criar minha conta" →
  CadastroScreen; ao autenticar, recarrega o carrinho e navega para
  CheckoutScreen substituindo a pilha do gate.
- **LoginScreen/CadastroScreen** ganham modo "retorno": quando abertos pelo
  gate, ao autenticar voltam com sucesso em vez de irem para HomeShell.
- **Pedidos/Perfil (visitante)**: widget `ConviteLogin` (ícone, texto, botões
  Entrar/Criar conta); após autenticar a aba recarrega.
- **Sair** (Perfil) volta para HomeShell visitante (não mais para LoginScreen).

## Visual

- **Amarelo Cimed** `#FFD500` como `cor_primaria` em `tenant_temas` (update no
  banco `fluxo_control`); `cor_secundaria` `#1A1A1A`.
- `TenantTheme.buildTheme()` calcula o foreground pela luminância da primária
  (texto/ícones escuros sobre amarelo; brancos sobre cores escuras) — AppBar,
  FilledButton, badge, splash.
- **Logo**: reprocessar `assets/logo/cahu.png` tornando pixels quase-brancos
  transparentes (System.Drawing); splash e login exibem sem moldura.

## Testes

- API: smoke manual (curl) do ciclo visitante→login→carrinho mesclado.
- App: `flutter analyze` limpo; widget test do CepScreen e do ConviteLogin;
  validação visual no Flutter web (login não obrigatório, amarelo aplicado).
