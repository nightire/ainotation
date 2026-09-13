import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [
    react(),
    ainotation({
      name: 'react',
    }),
  ],
});
