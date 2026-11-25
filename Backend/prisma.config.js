import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Use TEST_DATABASE_URL for tests, otherwise use DATABASE_URL or default
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (process.env.NODE_ENV === 'test' && !testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required in test mode; refusing to use DATABASE_URL.'
  );
}

const databaseUrl = testDatabaseUrl ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: databaseUrl,
  },
});
