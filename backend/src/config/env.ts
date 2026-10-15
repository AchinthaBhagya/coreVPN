import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required('DATABASE_URL'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 15),
  seedDemo: process.env.SEED_DEMO === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '3xCode <noreply@localhost>',
  },
  discord: {
    enabled: process.env.DISCORD_ENABLED === 'true',
    defaultWebhook: process.env.DISCORD_WEBHOOK_DEFAULT ?? '',
  },
};

export const DEFAULT_CURRENCY = 'LKR';
