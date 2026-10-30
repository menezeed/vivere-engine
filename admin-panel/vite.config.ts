import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { assertAdminPanelEnv } from './config/viteEnvGuard';

export default defineConfig(({ mode }) => {
  // SEC-O F-04: falha antes de servir ou gerar o bundle se o ambiente não for o staging.
  assertAdminPanelEnv(loadEnv(mode, __dirname, 'VITE_'));

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  };
});
