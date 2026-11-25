import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

const resolveDatabaseUrl = () => {
  if (process.env.NODE_ENV === 'test') {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL is required in test mode; refusing to use DATABASE_URL.'
      );
    }
    return testDatabaseUrl;
  }
  return process.env.DATABASE_URL;
};

const createPrismaClient = () => {
  const connectionString = resolveDatabaseUrl();

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required. Configure your Supabase PostgreSQL connection string in Backend/.env'
    );
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: { url: connectionString },
    },
  });
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
