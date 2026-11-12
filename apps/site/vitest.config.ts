import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' falha de propósito fora do servidor do Next; nos testes vira módulo vazio.
      'server-only': fileURLToPath(new URL('./src/testes/server-only-vazio.ts', import.meta.url)),
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
