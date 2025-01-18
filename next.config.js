/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ['mssql'],
  env: {
    NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
  },
  webpack: (config, options) => {
    config.module.rules.push({
      test: /\.node$/,
      use: [
        {
          loader: 'nextjs-node-loader',
          options: {
            outputPath: config.output.path,
          },
        },
      ],
    })
    config.module.rules.push({
      test: /\.geojson$/,
      type: 'json',
    })
    return config
  },
  staticPageGenerationTimeout: 120,
}

export default nextConfig
