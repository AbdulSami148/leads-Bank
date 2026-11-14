/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output file tracing cannot write to the pre-existing `.next/trace` file
  // (owned by another account in this environment), so disable it for local
  // Windows builds only. Netlify builds (NETLIFY=true) use the default.
  outputFileTracing: process.env.NETLIFY !== 'true',
};

export default nextConfig;
