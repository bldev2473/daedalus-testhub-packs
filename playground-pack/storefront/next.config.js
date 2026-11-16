/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // testhub 실습 환경: 팩에 standalone 서버(server.js)만 넣는다
  output: "standalone",
  // 위 폴더(playground-pack)의 lockfile 을 작업 공간 루트로 잡지 않게 한다. 그러면 standalone 이 storefront/ 아래로 한 겹 더 들어간다
  outputFileTracingRoot: __dirname,
  // sharp(이미지 최적화)는 standalone 에 넣지 않는다. images.unoptimized 라 쓰지 않고,
  // 같이 들어오는 libvips(@img/sharp-libvips-*)가 LGPL-3.0 이라 팩의 라이선스 원칙에 맞지 않는다
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
}

module.exports = nextConfig
