import { defineConfig } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [
    vue(),
    ainotation({
      name: 'vue',
    }),
  ],
});
