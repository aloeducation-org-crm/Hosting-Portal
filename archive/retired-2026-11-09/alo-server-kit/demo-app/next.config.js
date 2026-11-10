/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/ai/:path*', destination: 'http://127.0.0.1:4000/:path*' }];
  }
};
module.exports = nextConfig;
