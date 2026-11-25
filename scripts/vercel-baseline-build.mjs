import { execSync } from 'node:child_process';

const run = (command, cwd = process.cwd()) =>
  execSync(command, { stdio: 'inherit', env: process.env, cwd });

if (process.env.VERCEL_ENV === 'production') {
  run('npx prisma migrate resolve --applied 20260625072809_init', 'Backend');
  run('npm run build:vercel');
} else {
  run('npm run build');
}
