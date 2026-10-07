import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const scaledSpacing = (spacing) => Object.fromEntries(
  Object.entries(spacing).map(([key, value]) => [key, key === '0' || key === 'px' ? value : `calc(${value} * var(--d, 1))`]),
);

export default defineConfig({
  plugins: [react()],

  // Tailwind se kompiluje při sestavení (dřív se za běhu stahoval z CDN, což je jen pro vývoj:
  // zpomalovalo to první vykreslení a ukázalo se nastylované až po načtení skriptu).
  // Konfigurace je tady, aby nebyl potřeba další soubor; direktivy @tailwind jsou v index.html.
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: ['./index.html', './src/**/*.{js,jsx}'],
          // Hustota rozhraní (Nastavení -> Vzhled): vnější a vnitřní mezery se násobí proměnnou --d (výchozí 1, kompaktní
          // 0,8, pohodlné 1,2). Šířky a výšky (w-*, h-*) se neškálují, ikony a ovladače zůstávají stejně velké.
          theme: {
            padding: ({ theme }) => scaledSpacing(theme('spacing')),
            margin: ({ theme }) => ({ auto: 'auto', ...scaledSpacing(theme('spacing')) }),
            gap: ({ theme }) => scaledSpacing(theme('spacing')),
            space: ({ theme }) => scaledSpacing(theme('spacing')),
          },
        }),
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
