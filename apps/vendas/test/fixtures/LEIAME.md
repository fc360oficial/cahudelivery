# Fixtures

Respostas REAIS da API de teste (cópia descartável do banco, vendedor `demo1`, 10/11/2026),
reduzidas a poucas linhas por lista e com tokens trocados por `AT`/`RT`:

- `sync.json`   — `GET /v1/vendas/sync` (4 clientes, 4 tabelas incl. uma de retirada, 10 produtos, 2 sem preço na 1ª tabela, preços dessas tabelas, 3 pedidos de histórico).
  Única parte NÃO real: `titulos` (o banco de teste não tem nenhum em aberto) foi escrita à mão no formato de `vendas-sync.service.ts`.
- `resumo.json` — `GET /v1/vendas/resumo`.
- `login.json`  — `POST /v1/vendas/login`.

Edição manual: o banco de teste tem preço de todos os produtos em todas as tabelas, então o preço do 8º produto
na 1ª tabela foi REMOVIDO da fixture para testar "produto sem preço na tabela".
