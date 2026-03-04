/** @type {import('next').NextConfig} */
module.exports = {
  async rewrites() {
    return [
      { source: '/.well-known/:path*', destination: '/api/mcp/well-known/:path*' },
    ];
  },
};
