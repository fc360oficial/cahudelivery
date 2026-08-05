# Upload de Foto de Produto (retaguarda) — Design

## Contexto

Maior gap descoberto na sessão de 05/08/2026: não existe NENHUMA tela na retaguarda pra subir
foto de produto. Os 20 produtos demo só têm foto porque foram inseridos via script SQL direto
(Pexels, sessões de 16/07). O mecanismo de upload já existe e funciona (`POST /admin/upload`,
usado hoje em Banners e Categorias), e o banco já está pronto: tabela `produto_imagens`
(`produto_id`, `url`, `ordem`, `origem` — `'retaguarda'` ou `'erp'`, já pensando na Fase 4/Dlinks
trazendo foto automática). Só falta ligar isso na tela de Produtos. Sem migração nova.

## Escopo

Uma foto de capa por produto, gerenciada direto na tabela de Produtos (sem abrir modal nem
página de detalhe — decisão do Tiago em brainstorming: manter no mesmo padrão inline de
Banners/Categorias). Múltiplas fotos por produto (o app já tem carrossel pronto em
`produto_screen.dart` pra isso) fica fora de escopo por ora — pode virar uma v2 se precisar.

## Arquitetura

### 1. Backend — nenhuma migração, dois endpoints novos

A "foto de capa" de um produto é sempre a linha de menor `ordem` em `produto_imagens` (mesma
convenção que `catalog.service.ts` e `produto_card.dart` já usam pra escolher a miniatura —
`imagens.first`/`order by ordem limit 1`).

`AdminService` (mesmo padrão de `alternarProduto`/`descontoQtdProduto`, com auditoria):

- **`definirImagemProduto(produtoId, url, usuarioId)`**: confirma que o produto existe (404 se
  não), busca a linha de menor `ordem` pra esse `produto_id`; se existir, `UPDATE` da `url`
  nela; se não existir, `INSERT` nova com `ordem=0, origem='retaguarda'`. Grava auditoria
  (`acao='definir_imagem_produto'`, `entidade='produto'`, `dados_json={url}`).
- **`removerImagemProduto(produtoId, usuarioId)`**: confirma que o produto existe (404 se não),
  apaga a linha de menor `ordem` pra esse `produto_id` (se houver). Grava auditoria
  (`acao='remover_imagem_produto'`).

`AdminController`:

```ts
@Put('produtos/:id/imagem')
definirImagem(@Param('id') id: string, @Body() dto: DefinirImagemDto, @Req() req: RequestComAdmin) {
  return this.admin.definirImagemProduto(id, dto.url, req.admin.id);
}

@Delete('produtos/:id/imagem')
removerImagem(@Param('id') id: string, @Req() req: RequestComAdmin) {
  return this.admin.removerImagemProduto(id, req.admin.id);
}
```

`DefinirImagemDto { @IsNotEmpty() @IsString() url!: string; }`

`AdminService.produtos()` ganha um subselect novo na query de listagem:

```sql
(select url from produto_imagens where produto_id = p.id order by ordem asc limit 1) as imagem_url
```

### 2. Frontend (`apps/admin/src/paginas/Produtos.tsx`)

Nova coluna **"Foto"**, primeira coluna da tabela (miniatura 40×40, mesmo padrão visual da
coluna "Prévia" de `Banners.tsx`):

- Sem foto: placeholder cinza clicável (abre seletor de arquivo).
- Com foto: miniatura clicável (troca a foto) + botão **×** ao lado (remove).
- Estado de upload por linha (`subindoId`, não `subindo` booleano global como em Banners) — só
  aquela célula mostra "enviando…", resto da tabela continua usável.

```ts
async function escolherFoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
  const arquivo = e.target.files?.[0];
  if (!arquivo) return;
  setSubindoId(id);
  try {
    const url = await upload(arquivo);
    await api(`/admin/produtos/${id}/imagem`, { method: 'PUT', body: JSON.stringify({ url }) });
    carregar();
  } catch (err) {
    setErro((err as Error).message);
  } finally {
    setSubindoId(null);
    e.target.value = '';
  }
}

async function removerFoto(id: string) {
  if (!confirm('Remover a foto deste produto?')) return;
  await api(`/admin/produtos/${id}/imagem`, { method: 'DELETE' });
  carregar();
}
```

Texto de ajuda abaixo da tabela: "Foto quadrada, ideal 800×800, até 5MB (PNG/JPG/WEBP)."

`LinhaProduto` ganha `imagem_url?: string`.

## Erros e validação

- Reaproveita a validação de arquivo que já existe em `POST /admin/upload` (só imagem, até 5MB,
  PNG/JPG/WEBP/GIF) — nada novo aqui.
- `PUT`/`DELETE .../imagem` lançam 404 se o produto não existir (mesmo padrão de
  `alternarProduto`).
- Erro de upload ou de salvar aparece na mesma faixa vermelha (`erro-texto`) que já existe no
  topo da tela de Produtos.

## Fora de escopo (não implementar agora)

- Múltiplas fotos por produto / reordenar / galeria.
- Importação em lote por SKU (Tiago descartou explicitamente em brainstorming anterior).
- Distinção de UI entre imagem `origem='retaguarda'` e `origem='erp'` — a Fase 4 (Dlinks) ainda
  não existe, então hoje toda imagem é `'retaguarda'`.

## Teste

Validação com `curl` real, ponta a ponta: subir imagem → `PUT` capa → `GET /admin/produtos`
mostra `imagem_url` → `GET /v1/produtos/:id` (lado cliente) já mostra em `imagens[]` → `DELETE`
remove e `imagem_url` volta a `null`. Depois, checagem visual no navegador (Chrome DevTools MCP)
do fluxo completo na tela de Produtos — mesmo padrão de validação usado nas últimas features do
projeto (Carteira, Indica CAHU), não só `tsc`/build.

Relacionado: [[fluxo-commerce]]