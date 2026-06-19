# Teclia Academia

This repository contains a React frontend and an Express backend for the Teclia Academia project.

## Local Setup

Follow these steps to run both frontend and backend locally.

### 1. Backend Setup

1. Open a terminal and navigate to the backend folder:

```bash
cd Backendd
```

2. Install backend dependencies:

```bash
npm install
```

3. Start the backend server:

```bash
npm run dev
```

This will start the backend on port `3001` by default.

#### Optional: Run production backend

```bash
npm start
```

### 2. Frontend Setup

1. Open a second terminal and navigate to the project root:

```bash
cd ..
```

2. Install frontend dependencies:

```bash
npm install
```

3. Start the Vite development server:

```bash
npm run dev
```

The frontend will start on the default Vite port, usually `5173`.

### 3. Configure Frontend to Use Local Backend

The frontend currently points to a deployed backend URL in `src/services/api.js`.

To use your local backend instead, update `BACKEND_BASE_URL` in `src/services/api.js`:

```js
export const BACKEND_BASE_URL = 'http://localhost:3001';
```

Then restart the frontend.

## Notes

- The backend uses `dotenv` and can support environment variables like `PORT`, `DATABASE_URL`, `DATABASE_PATH`, and `JWT_SECRET`.
- If `JWT_SECRET` is not set, the backend uses a development fallback secret.
- The frontend runs independently from the backend, so make sure both are running before testing functionality.

## Database SQL Setup

This project supports both SQLite and PostgreSQL.

### SQLite SQL script

Use this script if you want the default local SQLite database setup.

File: `Backend/sqlite_setup.sql`

Run:

```bash
cd Backend
sqlite3 teclia.db < sqlite_setup.sql
```

### PostgreSQL SQL script

Use this script if you want to initialize a Postgres database.

File: `Backend/postgres_setup.sql`

Example with `psql`:

```bash
cd Backend
psql "$DATABASE_URL" -f postgres_setup.sql
```

### Supabase setup

To run the script in Supabase:a

1. Create a new Supabase project.
2. Open the SQL editor in Supabase.
3. Paste the contents of `Backend/postgres_setup.sql` and execute it.
4. Set the Supabase database URL in the backend environment as `DATABASE_URL`.

If you do not have `psql`, install the PostgreSQL client or use your preferred Postgres tool.

### Seed data includedd:
The SQL scripts create these tables:

- `users`
- `content`
- `site_stats`

The scripts also insert a local admin user and a sample content row.

Admin credentials:

- email: `austinrmz2007@gmail.com`
- password: `Mondaisa2007*`

## Quick Commands

From the repository root:

```bash
# Start the backend
cd Backend && npm install && npm run dev

# In a separate terminal, start the frontend
cd .. && npm install && npm run dev
```
