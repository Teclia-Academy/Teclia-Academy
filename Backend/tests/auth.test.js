import request from 'supertest';
import app from '../app.js';
import { setupTestDb } from './helpers/db.setup.js';
import { normalUser, studentUser } from './fixtures/users.js';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient.js';
import { hashToken } from '../services/refreshTokenService.js';

setupTestDb();

// Helpers for the rotation / reuse suite.
// Signup already logs the user in (returns an access + refresh pair) and starts
// exactly one token family, so it is the cleanest single-family starting point.
const registerUser = async (user = normalUser) => {
  const res = await request(app).post('/api/auth/signup').send(user);
  return { token: res.body.token, refreshToken: res.body.refreshToken };
};

const doRefresh = (refreshToken) =>
  request(app).post('/api/auth/refresh').send({ refreshToken });

describe('Authentication System', () => {
  describe('POST /api/auth/signup', () => {
    it('should register a new user with valid data and return 201', async () => {
      const res = await request(app).post('/api/auth/signup').send(normalUser);
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('user');
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user.email).toBe(normalUser.email.toLowerCase());
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user.role).toBe('student');
    });

    it('should not allow duplicate email registration', async () => {
      await request(app).post('/api/auth/signup').send(normalUser);
      const res = await request(app).post('/api/auth/signup').send(normalUser);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/email.*registered|duplicate/i);
    });

    it('should reject signup with missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'test@example.com' }); // Missing password and name
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject signup with weak password', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Test User',
          email: 'weak@example.com',
          password: 'weak', // Too short and no numbers
        });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject signup with invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Test User',
          email: 'notanemail',
          password: 'ValidPass123',
        });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(normalUser);
    });

    it('should login with valid credentials and return token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: normalUser.password,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(normalUser.email.toLowerCase());
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should fail login with wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: 'WrongPassword123!',
        });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/invalid credentials/i);
    });

    it('should fail login for nonexistent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/invalid credentials/i);
    });

    it('should fail login with missing email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: normalUser.password });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should fail login with missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: normalUser.email });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should normalize email to lowercase on login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email.toUpperCase(),
          password: normalUser.password,
        });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(normalUser.email.toLowerCase());
    });
  });

  describe('Token Verification and Protected Routes', () => {
    let token;
    let refreshToken;
    
    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(normalUser);
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: normalUser.password,
        });
      token = res.body.token;
      refreshToken = res.body.refreshToken;
    });

    it('should allow access to protected route with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(normalUser.email.toLowerCase());
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should reject access without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/authentication required|no token/i);
    });

    it('should reject access with invalid token format', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'InvalidFormat token');
      expect(res.status).toBe(401);
    });

    it('should reject access with malformed token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer malformed.token.here');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject access with empty Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
    });

    it('should return user data with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user).toHaveProperty('email');
      expect(res.body.user).toHaveProperty('name');
      expect(res.body.user).toHaveProperty('role');
    });
  });

  describe('POST /api/auth/refresh - Token Renewal', () => {
    let refreshToken;
    let expiredToken;

    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(normalUser);
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: normalUser.password,
        });
      refreshToken = res.body.refreshToken;

      // Create an expired token for testing
      expiredToken = jwt.sign(
        { id: 1, role: 'student' },
        process.env.JWT_SECRET,
        { expiresIn: '0s' } // Already expired
      );
    });

    it('should refresh token with valid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.token).not.toBe(refreshToken); // New token should be different
    });

    it('should fail refresh with missing refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should fail refresh with invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/invalid|expired/i);
    });

    it('should fail refresh with expired refresh token', async () => {
      // Create a token that has expired
      const oldRefreshToken = jwt.sign(
        { id: 1, role: 'student' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' } // Expired 1 hour ago
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should fail refresh for nonexistent user', async () => {
      const fakeRefreshToken = jwt.sign(
        { id: 99999, role: 'student' }, // Non-existent user
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: fakeRefreshToken });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should return new tokens with refreshed token', async () => {
      const firstRefresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(firstRefresh.status).toBe(200);
      const newToken = firstRefresh.body.token;
      const newRefreshToken = firstRefresh.body.refreshToken;

      // Verify the new token can be used
      const verifyRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${newToken}`);
      expect(verifyRes.status).toBe(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    let token;

    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(normalUser);
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: normalUser.password,
        });
      token = res.body.token;
    });

    it('should logout successfully', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toMatch(/logout.*successful/i);
    });

    it('should allow logout without token (stateless)', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
    });
  });

  describe('Error Handling Consistency', () => {
    it('should return consistent error for authentication failures', async () => {
      // Test 1: No token
      const res1 = await request(app).get('/api/auth/me');
      expect(res1.status).toBe(401);
      expect(res1.body).toHaveProperty('error');

      // Test 2: Invalid token
      const res2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid');
      expect(res2.status).toBe(401);
      expect(res2.body).toHaveProperty('error');

      // Test 3: Expired token
      const expiredToken = jwt.sign(
        { id: 1, role: 'student' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );
      const res3 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res3.status).toBe(401);
      expect(res3.body).toHaveProperty('error');
    });

    it('should return consistent error for wrong credentials', async () => {
      await request(app).post('/api/auth/signup').send(normalUser);

      // Wrong password
      const res1 = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: 'WrongPassword123!',
        });
      expect(res1.status).toBe(401);
      expect(res1.body.error).toMatch(/invalid credentials/i);

      // Non-existent user
      const res2 = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        });
      expect(res2.status).toBe(401);
      expect(res2.body.error).toMatch(/invalid credentials/i);
    });
  });

  describe('Admin Authorization', () => {
    it('should reject non-admin users from admin routes', async () => {
      // Register and login as regular student
      await request(app).post('/api/auth/signup').send(normalUser);
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: normalUser.email,
          password: normalUser.password,
        });
      const token = loginRes.body.token;

      // Try to access admin route
      const res = await request(app)
        .get('/api/auth/students')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/admin/i);
    });
  });
});

describe('Refresh Token Rotation & Family Reuse Detection', () => {
  describe('Persistence & hashing', () => {
    it('persists only the SHA-256 hash of the refresh token, never plaintext', async () => {
      const { refreshToken } = await registerUser();

      const rows = await prisma.refreshToken.findMany();
      expect(rows.length).toBe(1);

      const row = rows[0];
      // Plaintext must never be stored.
      expect(row.tokenHash).not.toBe(refreshToken);
      // Stored value must be exactly the SHA-256 hash of the presented token.
      expect(row.tokenHash).toBe(hashToken(refreshToken));
      // No column should contain the raw token.
      expect(JSON.stringify(row)).not.toContain(refreshToken);
      // A fresh login row is neither rotated nor revoked.
      expect(row.rotatedAt).toBeNull();
      expect(row.revokedAt).toBeNull();
      expect(row.familyId).toBeTruthy();
    });

    it('starts a distinct family per authentication (signup + each login)', async () => {
      await request(app).post('/api/auth/signup').send(normalUser); // family #1
      const a = await request(app).post('/api/auth/login').send({ email: normalUser.email, password: normalUser.password }); // #2
      const b = await request(app).post('/api/auth/login').send({ email: normalUser.email, password: normalUser.password }); // #3

      const rows = await prisma.refreshToken.findMany();
      const families = new Set(rows.map((r) => r.familyId));
      expect(families.size).toBe(3);
      expect(a.body.refreshToken).not.toBe(b.body.refreshToken);
    });
  });

  describe('Happy-path rotation', () => {
    it('rotates the token and invalidates the presented one', async () => {
      const { refreshToken } = await registerUser();

      const rotated = await doRefresh(refreshToken);
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).toBeTruthy();
      expect(rotated.body.refreshToken).not.toBe(refreshToken);

      // The old token is now rotated in the DB.
      const oldRow = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
      expect(oldRow.rotatedAt).not.toBeNull();

      // The new token works for a subsequent refresh.
      const again = await doRefresh(rotated.body.refreshToken);
      expect(again.status).toBe(200);
    });

    it('keeps the whole rotation chain inside one family', async () => {
      const { refreshToken } = await registerUser();
      const r1 = await doRefresh(refreshToken);
      const r2 = await doRefresh(r1.body.refreshToken);
      expect(r2.status).toBe(200);

      const rows = await prisma.refreshToken.findMany();
      const families = new Set(rows.map((r) => r.familyId));
      expect(families.size).toBe(1); // one login → one family across the chain
      expect(rows.length).toBe(3); // original + 2 rotations
    });
  });

  describe('Reuse detection (attack narrative)', () => {
    it('revokes the entire family when an already-rotated token is replayed', async () => {
      // Victim logs in and refreshes once (T0 -> T1).
      const { refreshToken: t0 } = await registerUser();
      const rotated = await doRefresh(t0);
      expect(rotated.status).toBe(200);
      const t1 = rotated.body.refreshToken;

      // Attacker replays the stolen, already-rotated T0.
      const reuse = await doRefresh(t0);
      expect(reuse.status).toBe(401);
      expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSE');

      // The legitimate newer sibling T1 must ALSO be dead now (family revoked).
      const sibling = await doRefresh(t1);
      expect(sibling.status).toBe(401);

      // Every row in the family is revoked in the DB.
      const rows = await prisma.refreshToken.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    });

    it('replaying a token whose family was already revoked stays 401', async () => {
      const { refreshToken: t0 } = await registerUser();
      const t1 = (await doRefresh(t0)).body.refreshToken;
      await doRefresh(t0); // triggers reuse + family revoke

      // Present the (already revoked) sibling again.
      const res = await doRefresh(t1);
      expect(res.status).toBe(401);
    });
  });

  describe('Logout durability', () => {
    it('revokes the family so a stolen refresh token cannot be used after logout', async () => {
      const { token, refreshToken } = await registerUser();

      const logout = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken });
      expect(logout.status).toBe(200);

      const afterLogout = await doRefresh(refreshToken);
      expect(afterLogout.status).toBe(401);

      const rows = await prisma.refreshToken.findMany();
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    });

    it('logout without a refresh token still returns 200 (stateless)', async () => {
      const { token } = await registerUser();
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/auth/logout-all');
      expect(res.status).toBe(401);
    });

    it('revokes every family for the user across devices', async () => {
      // Two independent logins => two families for the same user.
      await request(app).post('/api/auth/signup').send(normalUser);
      const l1 = await request(app).post('/api/auth/login').send({ email: normalUser.email, password: normalUser.password });
      const l2 = await request(app).post('/api/auth/login').send({ email: normalUser.email, password: normalUser.password });

      const res = await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${l1.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.revoked).toBeGreaterThanOrEqual(2);

      // Both families are now unusable.
      expect((await doRefresh(l1.body.refreshToken)).status).toBe(401);
      expect((await doRefresh(l2.body.refreshToken)).status).toBe(401);

      const rows = await prisma.refreshToken.findMany();
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    });
  });

  describe('Concurrency', () => {
    it('allows at most one winner when the same token is refreshed twice concurrently', async () => {
      const { refreshToken } = await registerUser();

      const [a, b] = await Promise.all([doRefresh(refreshToken), doRefresh(refreshToken)]);
      const statuses = [a.status, b.status];
      const successes = statuses.filter((s) => s === 200);

      // Never two independent winners (no split-brain minting).
      expect(successes.length).toBeLessThanOrEqual(1);
      // The loser fails safe with a 401 (invalid or reuse).
      expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);

      // The original token is never simultaneously valid twice.
      const originalRow = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
      expect(originalRow.rotatedAt).not.toBeNull();
    });
  });

  describe('Token type discriminator', () => {
    it('rejects an access token presented at the refresh endpoint', async () => {
      const { token } = await registerUser();
      const res = await doRefresh(token); // access token, no typ:'refresh'
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('rejects a refresh token presented as an access Bearer token', async () => {
      const { refreshToken } = await registerUser();
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe('Expiry & unknown tokens', () => {
    it('rejects an expired refresh JWT with 401', async () => {
      const expired = jwt.sign(
        { id: 1, role: 'student', typ: 'refresh', fid: 'f', jti: 'j' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );
      const res = await doRefresh(expired);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('REFRESH_TOKEN_EXPIRED');
    });

    it('rejects a well-formed but never-persisted refresh token', async () => {
      await request(app).post('/api/auth/signup').send(normalUser);
      const orphan = jwt.sign(
        { id: 1, role: 'student', typ: 'refresh', fid: 'nope', jti: 'nope' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      const res = await doRefresh(orphan);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });
});
