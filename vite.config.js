import preact from '@preact/preset-vite'
import swc from 'unplugin-swc'
import { pluginAPIRoutes as apiRoutes } from 'vite-plugin-api-routes'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [
    preact(),
    swc.vite({
      jsc: {
        transform: {
          react: {
            pragma: 'h',
            pragmaFrag: 'Fragment',
            importSource: 'preact',
          },
        },
      },
    }),
    apiRoutes(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  server: {
    port: 3000,
  },
  css: {
    postcss: './postcss.config.js',
  },
  optimizeDeps: {
    exclude: ['msnodesqlv8'],
    include: ['preact', 'preact/hooks', 'vite-plugin-api-routes'],
  },
  build: {
    commonjsOptions: {
      exclude: ['msnodesqlv8'],
    },
    minify: process.env.NODE_ENV === 'production',
    outDir: 'dist/public',
  },
  ssr: {
    noExternal: ['msnodesqlv8'],
  },
})
