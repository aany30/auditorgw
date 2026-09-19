/** @type {import('next').NextConfig} */
const webpack = require("webpack");

const nextConfig = {
  env: {
    NEXT_PUBLIC_HAS_DEFAULT_CREDS:
      process.env.DEFAULT_META_ACCESS_TOKEN || process.env.DEFAULT_DV360_REFRESH_TOKEN ? "1" : "",
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pptxgenjs uses "node:fs", "node:https" etc. — strip the prefix so
      // the fallback map below can stub them out for the browser bundle.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        https: false,
        http: false,
        zlib: false,
        net: false,
        tls: false,
        child_process: false,
        buffer: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
