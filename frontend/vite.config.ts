/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Port und Host kommen aus der Umgebung – nichts ist fest verdrahtet.
export default defineConfig({
  // Relative Pfade: funktioniert auch hinter einem Reverse-Proxy mit Unterpfad
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: process.env.NEXUS_DEV_HOST ?? 'localhost',
    port: Number(process.env.NEXUS_DEV_PORT ?? 5173),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
