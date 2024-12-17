/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server Actions are no longer experimental in Next.js 14
  webpack: config => {
    config.module.rules.push({
      test: /\.json$/,
      type: 'json',
    })
    return config
  },
}

export default nextConfig
