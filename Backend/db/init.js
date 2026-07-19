import prisma from '../utils/prismaClient.js';

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

export const connectDb = async () => {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Configure your Supabase PostgreSQL connection string in Backend/.env'
    );
  }

  if (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.TEST_DATABASE_URL);
  } else if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL);
  }

  await prisma.$connect();
  console.log('✓ Database connected via Prisma');
};

export const initDb = connectDb;

export default { connectDb, initDb };
