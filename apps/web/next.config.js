/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compile workspace TypeScript packages inside the Next.js bundler
  transpilePackages: ["@klaw/core", "@klaw/database"],
};

module.exports = nextConfig;
