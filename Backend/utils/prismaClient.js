import { PrismaClient } from '@prisma/client';
// Try to dynamically load the Postgres adapter at module load time (top-level await allowed in ESM).
let PrismaPg;
try {
  // Attempt to load adapter if present in node_modules (may not exist for Prisma v4 setups)
  // eslint-disable-next-line node/no-unsupported-features/es-syntax
  const mod = await import('@prisma/adapter-pg').catch(() => undefined);
  PrismaPg = mod?.PrismaPg;
} catch (e) {
  PrismaPg = undefined;
}
const globalForPrisma = globalThis;

const normalizeDatabaseUrl = (databaseUrl) => {
  if (typeof databaseUrl !== 'string') {
    return databaseUrl;
  }

  const trimmed = databaseUrl.trim();
  if (trimmed.startsWith('sqlite:')) {
    return `file:${trimmed.slice('sqlite:'.length)}`;
  }

  return trimmed;
};

const resolveDatabaseUrl = () => {
  const fromEnv = process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

  return normalizeDatabaseUrl(fromEnv);
};

const createAdapter = () => {
  const connectionString = resolveDatabaseUrl();

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required. Configure your Supabase PostgreSQL connection string in Backend/.env'
    );
  }

  const isPostgres = connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://');

  if (!isPostgres) {
    return undefined;
  }

  // Use the adapter loaded at module initialization. If not available, surface a clear error.
  if (!PrismaPg) {
    throw new Error('Postgres adapter @prisma/adapter-pg is required for Postgres DATABASE_URL but is not installed.');
  }

  const isSupabase = connectionString.includes('supabase.co');

  return new PrismaPg({
    connectionString,
    ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
  });
};

const createPrismaClient = () => {
  const adapter = createAdapter();
  const options = {
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };

  if (adapter) {
    options.adapter = adapter;
  }

  return new PrismaClient(options);
};

const getPrisma = () => {
  if (!globalForPrisma.__tecliaPrisma) {
    globalForPrisma.__tecliaPrisma = createPrismaClient();
  }
  return globalForPrisma.__tecliaPrisma;
};

const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getPrisma();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);

export default prisma;
