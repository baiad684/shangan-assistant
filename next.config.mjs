/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 手机局域网访问时允许跨源调试（Next 15 的 dev origin 校验）
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default nextConfig;
