/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
    serverActions: true,
  },
  serverExternalPackages: ['mssql'],
  env: {
    NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
  },
}

export default nextConfig
