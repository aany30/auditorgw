/** @type {import('next').NextConfig} */
const webpack = require("webpack");

const nextConfig = {
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
