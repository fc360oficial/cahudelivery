# Fluxo Entregas — onde parou (17/11/2026)

Leia este arquivo primeiro para continuar a fase 1 em outra máquina. Tudo está no ramo `fluxo-entregas` (não está na `main` e nada foi publicado).

```
git fetch origin
git switch fluxo-entregas
```

Mockup aprovado das telas: https://claude.ai/artifact/LEDKL2XcgXqUx4jP7aEHBz

## Decisões do Tiago

- **Produto separado**: APK próprio "Fluxo Entregas" (motorista), com o **mesmo visual do Fluxo Vendas** (é o mesmo produto). Referência visual = prints do app de vendas em https://claude.ai/artifact/WX25pLyampGJ5zTsoWvs26 e o código do app de vendas, que está no notebook do Tiago.
- **Entram** pedidos do app, do site, dos vendedores e do **televendas do Dlinks** (rota `POST /v1/integracoes/dlinks/notas-entrega`; texto para o Dlinks em `docs/integracao-dlinks-notas-entrega.md`, falta colar no `03-INTEGRACAO-DLINKS-HANDOFF` do OneDrive e regerar o PDF).
- **Carga**: o sistema sugere pelos endereços; o **gerente do CD autoriza**, tira ou troca. Nada sai sem autorização. 6 caminhões próprios.
- **Peso**: gramatura do nome × quantidade da caixa × quantidade do pedido; o que o nome não diz, o CD informa na tela Peso dos produtos.
- **Comprovante**: **romaneio impresso** (uma folha por carga, uma linha de assinatura por cliente). O motorista fotografa a linha assinada no app. **Sem assinatura na tela do celular.**
- **Ocorrências** (avaria com foto, falta, troca, item recusado): o gerente só registra o que combinou; nota, crédito e estoque continuam pelo Dlinks.
- **Tempos**: botão "Cheguei no cliente"; a conclusão é a própria entrega. Retaguarda mostra trajeto e tempo no cliente.
- **Localização**: o CD vê o caminhão no mapa durante a rota. **O app BLOQUEIA até o motorista ativar a localização** ("Permitir o tempo todo" + GPS ligado); se tirar no meio da rota, volta a bloquear. Pedir também para tirar o app da economia de bateria. **Não** colocar texto dizendo que o CD vê a localização; o pedido fala da função (registrar chegada e entrega).

## O que está pronto (commits no ramo)

| Etapa | Commit | O quê |
|---|---|---|
| Notas do televendas | `0b5deda` | migração 041 `notas_entrega`, rota do Dlinks (este já está na `main` e no GitHub) |
| 1 | `cc8971a` | migração 042, solução "entregas" na retaguarda, Caminhões e motoristas (login do motorista) |
| 2 | `90703c4` | Notas a entregar com peso estimado (`peso-estimado.ts`) |
| 3 | `49edbd2` | Peso dos produtos |
| 4 | `b04c774` | migração 043, Montar cargas (sugestão, autorizar, reabrir) e romaneio A4 |
| 5 | `ee09cba` | migração 044, **API do app do motorista** |

### API do app (`apps/api/src/entregas/motorista*.ts`)

Cabeçalho `X-Tenant: cahu` em tudo; `Authorization: Bearer <accessToken>` depois do login; `X-App-Versao` opcional.

- `POST /v1/motorista/login` `{login, senha}` → `{accessToken, refreshToken, motorista, distribuidora}` (sessão de 30 dias)
- `POST /v1/motorista/refresh` `{refreshToken}`
- `GET /v1/motorista/carga` → `{carga: null}` ou a carga em rota/autorizada com `paradas[]` (`linhaIds`, cliente, endereço, lat/lng, notas, volumes, status `pendente|no_cliente|entregue|nao_entregue|parcial`, chegadaEm, itens das notas)
- `POST /v1/motorista/cargas/:id/iniciar` `{em}`
- `POST .../chegada` `{linhaIds, em, lat, lng}` → `{distanciaM, longe}` (longe = mais de 1,5 km)
- `POST .../entregue` (multipart) `linhaIds` (lista separada por vírgula), `recebedorNome`, `recebedorDocumento?`, `em`, `lat`, `lng`, arquivos `assinatura` (obrigatório) e `mercadoria`
- `POST .../nao-entregue` (multipart) `linhaIds`, `motivo` (`cliente_fechado|sem_recebedor|recusou|endereco_nao_encontrado|outro`), `observacao` (obrigatória em "outro"), arquivo `foto`
- `POST .../ocorrencias` (multipart) `id` (uuid gerado no celular), `linhaId`, `tipo` (`avaria|falta|troca|recusa_item`), `produtoCodigo`, `produtoDescricao`, `quantidade`, `observacao`, `em`, arquivo `foto` (obrigatório em avaria)
- `POST .../encerrar` `{em}` (só com todas as paradas resolvidas)
- `POST /v1/motorista/posicoes` `{pontos: [{lat, lng, precisaoM, em}]}` (até 500; só vale com carga em rota)

Toda ação pode ser reenviada pela fila sem sinal sem duplicar. A hora (`em`) é a do celular; hora no futuro vira a do servidor.

## O que falta na fase 1

1. **App Flutter do motorista** (`apps/entregas`, partindo do código do app de vendas): login, tela de bloqueio da localização, carga do dia, a caminho, no cliente, ocorrência, comprovante (foto), entrega confirmada, não entregue, fila sem sinal, envio de posição em segundo plano com notificação fixa. Telas no mockup.
2. **Retaguarda "Em rota"**: mapa com a última posição, "sem localização há X min", tempos por parada, fotos, aviso de "Cheguei" longe, ocorrências para resolver.
3. **Publicar**: rodar as migrações 041, 042, 043 e 044 **antes** de reiniciar a API (sem a 042, salvar um administrador dá erro); juntar o ramo na `main`.

## Como conferir

- Testes da API: `npm test --workspace apps/api` (725 passando no fim da etapa 5).
- As consultas foram testadas num Postgres descartável (initdb numa pasta temporária, porta 55432, todas as migrações 001→044).
- Atenção: `apps/admin/src/index.css` tem regras **globais** de tabela (`tbody tr:last-child td { border-bottom: 0 }`) que afetam páginas sem layout, como o romaneio.
