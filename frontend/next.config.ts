import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // When using `next dev` behind Cloudflare Tunnel / custom host, HMR WebSocket needs this.
  allowedDevOrigins: [
    "transtrack-ddmrp.skom.my.id",
    "127.0.0.1",
    "localhost",
  ],
};

export default nextConfig;
