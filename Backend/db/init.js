import prisma from '../utils/prismaClient.js';

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

export const connectDb = async () => {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Configure your Supabase PostgreSQL connection string in Backend/.env'
    );
  }

  await prisma.$connect();
  console.log('✓ Database connected via Prisma');
};

export const initDb = connectDb;

export default { connectDb, initDb };
