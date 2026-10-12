/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev server only: let these hosts load the page's JS (Camofox's Docker
  // browser previewing the dashboard, and Cloudflare quick tunnels).
  allowedDevOrigins: ['host.docker.internal', '*.trycloudflare.com'],
};

export default nextConfig;
