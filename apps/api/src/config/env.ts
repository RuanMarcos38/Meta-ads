import 'dotenv/config';
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3333),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '0'.repeat(64),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  demoMode: (process.env.DEMO_MODE ?? 'true') === 'true',
  meta: {
    appId: process.env.META_APP_ID ?? '',
    appSecret: process.env.META_APP_SECRET ?? '',
    redirectUri: process.env.META_REDIRECT_URI ?? '',
    apiVersion: process.env.META_API_VERSION ?? 'v21.0',
  },
};
