import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', 'VITE_');
  const base = environment.VITE_BASE_PATH || '/';
  if (!/^\/(?:[\w.-]+\/)*$/.test(base)) throw new Error('VITE_BASE_PATH 必须以 / 开头、结尾，例如 /JSSZ/');
  return { plugins: [react()], base };
});
