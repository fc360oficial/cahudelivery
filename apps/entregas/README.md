# Fluxo Entregas (aplicativo do motorista)

App Flutter (Android) do motorista: carga do dia, chegada no cliente, foto da linha assinada no romaneio,
ocorrências, não entregue e localização durante a rota. Mesmo visual e mesma base do app Fluxo Vendas
(`apps/vendas`, ramo `fluxo-vendas-app`).

Fala só com a API `/v1/motorista/*` (`apps/api/src/entregas/motorista*.ts`), com `X-Tenant` em toda chamada.

## Regras que o app obedece

- **Bloqueia sem localização** (decisão do Tiago, 17/11/2026): depois do login, só passa da tela de bloqueio com
  o GPS ligado e a permissão "Permitir o tempo todo". Se tirar no meio da rota, volta a bloquear.
  O texto fala da função (registrar chegada e entrega); não diz que o CD acompanha.
- **Sem sinal funciona**: toda ação vai primeiro para a fila do aparelho (SQLite) e aparece na hora; sobe na
  ordem quando o sinal volta. Ação recusada pelo servidor sai da fila e aparece para o motorista avisar o CD.
- **Comprovante** = foto da linha assinada no romaneio impresso (ou do canhoto). Não há assinatura na tela.
- **Localização** só é enviada com a carga em rota, com o aviso fixo "Rota em andamento" (exigência do Android).

## Rodar e testar

```
flutter pub get
flutter test                                              # 16 testes
flutter test test/telas_imagens_test.dart --run-skipped   # imagens das telas em build/telas
```

## Gerar o APK

```
flutter build apk --release --dart-define=TENANT=cahu --dart-define=API_URL=https://cahudelivery.duckdns.org/v1 --dart-define=APP_VERSAO=1.0.0+1
```

Saída: `build/app/outputs/flutter-apk/app-release.apk`. Ainda assinado com a chave de teste (igual aos outros
apps): antes de entregar aos motoristas, criar a chave própria de assinatura, que NUNCA entra no repositório.
