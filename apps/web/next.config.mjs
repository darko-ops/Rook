/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@rook/core', '@rook/db', '@rook/engine'],
  serverExternalPackages: ['postgres'],
  webpack: (config) => {
    // workspace packages use NodeNext-style `.js` imports from TS source
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
