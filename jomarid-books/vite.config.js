import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  plugins: [react()],

  // Tailwind se kompiluje při sestavení (dřív se za běhu stahoval z CDN, což je jen pro vývoj:
  // zpomalovalo to první vykreslení a ukázalo se nastylované až po načtení skriptu).
  // Konfigurace je tady, aby nebyl potřeba další soubor; direktivy @tailwind jsou v index.html.
  css: {
    postcss: {
      plugins: [
        tailwindcss({ content: ['./index.html', './src/**/*.{js,jsx}'] }),
        autoprefixer(),
      ],
    },
  },

  esbuild: {
    keepNames: true,
  },

  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        keep_fnames: true,
        keep_classnames: true,
      },
      mangle: {
        keep_fnames: true,
        keep_classnames: true,
      },
    },
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          icons: ['lucide-react'],
        },
      },
    },
  },

  server: {
    port: 3000,
  },
});
