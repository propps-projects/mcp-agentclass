import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://askine.cc',
  output: 'static',
  integrations: [react()],
});
