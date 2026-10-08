import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const scaledSpacing = (spacing) => Object.fromEntries(
  Object.entries(spacing).map(([key, value]) => [key, key === '0' || key === 'px' ? value : `calc(${value} * var(--d, 1))`]),
);

// PWA: ze šablony src/pwa/sw.template.js vyrobí sw.js. Předem se uloží obal appky a skripty, které stránka potřebuje hned
// při startu (vstupní soubor a to, co z něj přímo importuje); ostatní (hry, správce, čtečka) se uloží až při prvním použití.
// Verze service workeru je otisk těchto souborů a souborů ve složce public, takže se mění jen s novým sestavením.
const pwaPlugin = () => ({
  name: 'jomarid-pwa',
  apply: 'build',
  generateBundle(_options, bundle) {
    const startup = new Set();
    const visit = (file) => {
      const chunk = bundle[file];
      if (!chunk || chunk.type !== 'chunk' || startup.has(file)) return;
      startup.add(file);
      (chunk.imports || []).forEach(visit);
    };
    Object.values(bundle).filter((c) => c.type === 'chunk' && c.isEntry).forEach((c) => visit(c.fileName));
    const publicDir = path.resolve('public');
    const publicFiles = fs.existsSync(publicDir) ? fs.readdirSync(publicDir).filter((f) => /\.(png|svg|ico|webmanifest)$/.test(f)).sort() : [];
    const required = [...startup].sort().map((f) => `/${f}`);
    const optional = publicFiles.map((f) => `/${f}`);
    const hash = crypto.createHash('sha1');
    [...required, ...optional].forEach((u) => hash.update(u));
    publicFiles.forEach((f) => hash.update(fs.readFileSync(path.join(publicDir, f))));
    const source = fs.readFileSync(path.resolve('src/pwa/sw.template.js'), 'utf8')
      .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 10)))
      .replace('[] /* REQUIRED */', JSON.stringify(required))
      .replace('[] /* OPTIONAL */', JSON.stringify(optional));
    if (source.includes('__VERSION__') || source.includes('/* REQUIRED */') || source.includes('/* OPTIONAL */')) throw new Error('Šablona service workeru má nedoplněné místo.');
    this.emitFile({ type: 'asset', fileName: 'sw.js', source });
  },
});

export default defineConfig({
  plugins: [react(), pwaPlugin()],

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
