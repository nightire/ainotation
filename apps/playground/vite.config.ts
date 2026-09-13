import { defineConfig } from 'vite-plus';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [
    ainotation({
      name: 'Ainotation Playground',
      // Keep the existing identity so previous Playground feedback stays available.
      id: '9966c904-ab78-4576-a233-00082bc77d5f',
    }),
  ],
});
