import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['192.168.1.171', '91.175.47.236', 'play.lavignere.eu', 'localhost', '127.0.0.1'],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Masque le bouton/badge "N" de Next en bas de l'écran en dev.
  devIndicators: false,
  // NOTE : le proxy Socket.IO est désormais géré par start-site.cjs
  // (reverse-proxy natif sur le port 50006). Les anciens "rewrites"
  // Next ne relayaient pas l'upgrade WebSocket en mode standalone,
  // ce qui causait les 404 sur /socket.io?EIO=4&transport=polling.
};

export default nextConfig;
