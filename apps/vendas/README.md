# Fluxo Vendas

Aplicativo do vendedor externo (pedidos e orçamentos, com ou sem internet). Flutter, Android e Windows.
Fala só com a API de Vendas (`/v1/vendas/*`). Manual de desenvolvimento: `.superpowers/sdd/app-base-report.md`.

```
flutter pub get
flutter test
flutter run -d windows --dart-define=API_URL=http://localhost:3099/v1
flutter build apk --debug --dart-define=API_URL=http://localhost:3099/v1
```

Configuração por `--dart-define`: `TENANT` (padrão `cahu`) e `API_URL`. Produção aponta sempre para a URL pública, nunca para IP local.
