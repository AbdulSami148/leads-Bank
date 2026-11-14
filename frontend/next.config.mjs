/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output file tracing cannot write to the pre-existing `.next/trace` file
  // (owned by another account in this environment), so disable it to allow a
  // clean production build.
  outputFileTracing: false,
};

export default nextConfig;
