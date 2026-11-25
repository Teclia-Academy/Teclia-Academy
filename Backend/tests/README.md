Backend tests for Teclia Academia

Prereqs
- Node >= 18
- PostgreSQL database for tests (Supabase branch or local Postgres)
- From the repository root run `npm install` inside `Backend/` to install dev dependencies.

Setup
- Set `TEST_DATABASE_URL` in `Backend/.env`. It must point to a dedicated, disposable test database.
- Never reuse `DATABASE_URL` or point `TEST_DATABASE_URL` at production; the test suite deletes data between tests.
- Apply migrations to the test database before running tests: `npm run prisma:deploy` (the Prisma config prefers `TEST_DATABASE_URL` when it is set).

Scripts
- `npm run test` — run tests once
- `npm run test:watch` — run tests in watch mode
- `npm run test:coverage` — run with coverage

Structure
- `tests/` contains `auth.test.js`, `content.test.js`, `stats.test.js`.
- `tests/helpers/db.setup.js` connects via Prisma and cleans data between tests.
- `tests/fixtures/` holds sample users and content used across tests.

Notes
- Some endpoints (e.g. `/api/auth/refresh`) are not implemented in the current backend; tests will reflect actual behavior.
- Tests are built to be isolated and remove created users/content between tests.

See also: [PRISMA_MIGRATION_GUIDE.md](../PRISMA_MIGRATION_GUIDE.md)
