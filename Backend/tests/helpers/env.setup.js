import 'dotenv/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required for backend tests; refusing to use DATABASE_URL.'
  );
}

if (applicationDatabaseUrl && applicationDatabaseUrl === testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL must be separate from DATABASE_URL; refusing to run tests against the application database.'
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

// Force Prisma to prefer WASM/test client engine during tests if supported.
// Set multiple env vars to increase compatibility across Prisma runtime versions.
process.env.TEST_CLIENT_ENGINE = process.env.TEST_CLIENT_ENGINE || 'wasm';
process.env.PRISMA_CLIENT_ENGINE = process.env.PRISMA_CLIENT_ENGINE || 'wasm';
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'wasm';
process.env.PRISMA_FORCE_WASM = process.env.PRISMA_FORCE_WASM || '1';
process.env.TEST_CLIENT_ENGINE_REMOTE_EXECUTOR = process.env.TEST_CLIENT_ENGINE_REMOTE_EXECUTOR || '';
