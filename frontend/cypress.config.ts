import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? 'http://localhost:5173',
    supportFile: false,
    video: false,
    env: { apiUrl: process.env.CYPRESS_API_URL ?? 'http://localhost:4000/api/v1', seedPassword: process.env.SEED_PASSWORD ?? 'ChangeMe-2026-dev' },
  },
});
