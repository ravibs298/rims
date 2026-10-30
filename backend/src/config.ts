import 'dotenv/config';

const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

const nodeEnv = env.NODE_ENV ?? 'development';

export const config = {
  env: nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(env.PORT ?? 4000),
  trustProxy: Number(env.TRUST_PROXY ?? (nodeEnv === 'production' ? 1 : 0)),
  db: {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 3306),
    user: env.DB_USER ?? 'rims',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME ?? 'rims',
    connectionLimit: Number(env.DB_POOL ?? 10),
  },
  jwt: { secret: jwtSecret, expiresIn: env.JWT_EXPIRES_IN ?? '8h' },
  bcryptRounds: Number(env.BCRYPT_ROUNDS ?? (nodeEnv === 'test' ? 4 : 12)),
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  rateLimit: {
    enabled: nodeEnv !== 'test' && env.RATE_LIMIT_DISABLED !== 'true',
    perMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 300),
  },
  integrations: {
    workerIntervalMs: Number(env.INTEGRATION_WORKER_INTERVAL_MS ?? 15000),
    backoffBaseMs: Number(env.INTEGRATION_BACKOFF_BASE_MS ?? 5000),
    backoffMaxMs: Number(env.INTEGRATION_BACKOFF_MAX_MS ?? 15 * 60 * 1000),
    httpTimeoutMs: Number(env.INTEGRATION_HTTP_TIMEOUT_MS ?? 10000),
  },
};
