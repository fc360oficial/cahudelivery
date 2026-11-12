import { defineConfig } from '@playwright/test';

// Precisa da API rodando em http://localhost:3000 com o banco de desenvolvimento (npm run api).
// E2E_BASE_URL aponta para um site já no ar (p.ex. `next dev --port 3011`); sem ela, sobe o build na 3010.
const baseExterna = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: baseExterna ?? 'http://localhost:3010' },
  webServer: baseExterna ? undefined : {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3010',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
