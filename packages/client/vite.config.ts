import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve workspace packages from their source — no pre-build needed in dev.
const workspaceAlias = (pkg: string) => path.resolve(__dirname, `../${pkg}/src`);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Skerry',
        short_name: 'Skerry',
        description: 'Explore, trade, settle.',
        theme_color: '#1a1a2e',
        icons: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@arch/core': workspaceAlias('core'),
      '@arch/protocol': workspaceAlias('protocol'),
      '@arch/bots': workspaceAlias('bots'),
    },
  },
});
