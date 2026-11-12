import { defineConfig } from '@playwright/test';

// Precisa da API rodando em http://localhost:3000 com o banco de desenvolvimento (npm run api).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3010' },
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3010',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
