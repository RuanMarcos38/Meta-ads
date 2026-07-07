import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'sim'].includes(value.toLowerCase());
  return value;
}, z.boolean());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32).max(64),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  API_PORT: z.coerce.number().default(3333),
  SYNC_CRON: z.string().default('*/10 * * * *'),
  DEMO_MODE: boolFromEnv.default(true),
  META_GRAPH_VERSION: z.string().default('v20.0'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional().default(''),
  GOOGLE_ADS_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_ADS_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional().default('')
});

export const env = schema.parse(process.env);
