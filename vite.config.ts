import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { devMigrations } from './scripts/vite-dev-migrations.ts'

// The devtools plugin injects source-location attributes into every element
// and opens an SSE channel per tab; opt in with TECDEBT_DEVTOOLS=true.
const devtoolsEnabled = process.env.TECDEBT_DEVTOOLS === 'true'

const config = defineConfig({
  // Dev/preview servers run behind sandbox proxies that forward arbitrary
  // hostnames, which Vite's host check would otherwise reject.
  server: {
    allowedHosts: true,
    // Scan checkouts live under data/; they must never trigger dev reloads.
    watch: {
      ignored: [
        '**/data/**',
        '**/eve/**',
        '**/drizzle/**',
        '**/.output/**',
        '**/.tanstack/**',
      ],
    },
  },
  preview: { allowedHosts: true },
  resolve: {
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Everything the client can reach is listed so Vite never discovers a
    // dependency mid-session; each discovery re-bundles and reloads the page.
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
      '@base-ui/react/button',
      '@base-ui/react/collapsible',
      '@base-ui/react/dialog',
      '@base-ui/react/input',
      '@base-ui/react/merge-props',
      '@base-ui/react/scroll-area',
      '@base-ui/react/switch',
      '@base-ui/react/tooltip',
      '@base-ui/react/popover',
      '@base-ui/react/use-render',
      '@tanstack/router-core',
      '@tanstack/router-core/isServer',
      '@tanstack/router-core/ssr/client',
      '@tanstack/react-devtools',
      'class-variance-authority',
      'clsx',
      'lucide-react',
      'react-markdown',
      'remark-gfm',
      'seroval',
      'sonner',
      'tailwind-merge',
      'zustand',
      'zustand/middleware',
    ],
  },
  plugins: [
    ...(devtoolsEnabled ? [devtools()] : []),
    devMigrations(),
    tailwindcss(),
    tanstackStart({
      router: {
        codeSplittingOptions: {
          defaultBehavior: [
            [
              'component',
              'pendingComponent',
              'errorComponent',
              'notFoundComponent',
            ],
          ],
        },
      },
    }),
    nitro({ preset: 'bun' }),
    viteReact(),
  ],
})

export default config
