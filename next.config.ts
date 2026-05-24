import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // pdf-parse and mammoth are Node.js-only — exclude from Turbopack bundling
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace('https://', '')

    const csp = [
      "default-src 'self'",
      // Next.js requires unsafe-inline for its runtime hydration scripts
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      // Supabase realtime WebSocket + REST, AWS Bedrock, Google OAuth
      `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://bedrock-runtime.${process.env.AWS_REGION ?? 'ap-south-1'}.amazonaws.com https://accounts.google.com`,
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',            value: 'DENY' },
          { key: 'X-Content-Type-Options',      value: 'nosniff' },
          { key: 'Referrer-Policy',             value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',          value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-XSS-Protection',            value: '1; mode=block' },
          { key: 'Content-Security-Policy',     value: csp },
          // HSTS: tell browsers to always use HTTPS for 1 year
          { key: 'Strict-Transport-Security',   value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
};

export default nextConfig;
