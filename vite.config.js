import pluginReact from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import { pluginAPIRoutes } from 'vite-plugin-api-routes'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'

export default defineConfig({
  plugins: [pluginReact(), pluginAPIRoutes({})],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
    include: ['vite-plugin-api-routes'],
  },
  build: {
    commonjsOptions: {
      exclude: ['msnodesqlv8'],
    },
    minify: false,
    outDir: 'dist/public',
  },
  ssr: {
    noExternal: ['msnodesqlv8'],
  },
})
