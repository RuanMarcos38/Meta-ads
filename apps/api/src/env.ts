import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'sim'].includes(value.toLowerCase());
  return value;
}, z.boolean());

function cronFromMinutes(minutes: number) {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 15;
  return `*/${safe} * * * *`;
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  API_PORT: z.coerce.number().optional(),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3333'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().min(32),
  CORS_ORIGINS: z.string().default('https://gestao.r2rmarketingdigital.com.br,http://localhost:5173,http://localhost:3000'),
  WEB_ORIGIN: z.string().optional(),
  DEMO_MODE: boolFromEnv.default(false),
  SYNC_INTERVAL_MINUTES: z.coerce.number().default(15),
  SYNC_CRON: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@r2rmarketingdigital.com.br'),
  SEED_ADMIN_PASSWORD: z.string().default('123456'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_API_VERSION: z.string().default('v21.0'),
  META_GRAPH_VERSION: z.string().optional(),
  META_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional().default(''),
  GOOGLE_ADS_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_ADS_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional().default(''),
  GOOGLE_ADS_API_VERSION: z.string().default('v17')
});

const parsed = schema.parse(process.env);
const corsOrigins = parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);

export const env = {
  ...parsed,
  API_PORT: parsed.API_PORT ?? parsed.PORT,
  CORS_ORIGINS: corsOrigins,
  WEB_ORIGIN: parsed.WEB_ORIGIN ?? parsed.APP_URL,
  META_API_VERSION: parsed.META_GRAPH_VERSION ?? parsed.META_API_VERSION,
  SYNC_CRON: parsed.SYNC_CRON ?? cronFromMinutes(parsed.SYNC_INTERVAL_MINUTES)
};
