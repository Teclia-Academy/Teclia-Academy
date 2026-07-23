import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import app from '../app.js';
import { setupTestDb } from './helpers/db.setup.js';
import prisma from '../utils/prismaClient.js';

const signWebhookPayload = (payload) => {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

setupTestDb();

describe('Payment idempotency', () => {
  let authToken;
  let testUserId;

  beforeEach(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret';
    }
    const user = await prisma.user.create({
      data: {
        email: `test-payments-${Date.now()}@example.com`,
        passwordHash: 'hashed-password',
        name: 'Payment User',
      },
    });
    testUserId = user.id;
    authToken = jwt.sign(
      { id: user.id, role: user.role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.JWT_SECRET
    );
  });

  afterEach(async () => {
    await prisma.paymentMethodEvent.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('posting same idempotencyKey twice creates a single Payment', async () => {
    const payload = { paymentMethodId: 'pm_test_123', planTier: 'basico' };
    const idempotencyKey = `test-key-${Date.now()}`;

    const res1 = await request(app)
      .post('/api/payments/payment-method')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(res1.statusCode).toBe(200);

    const res2 = await request(app)
      .post('/api/payments/payment-method')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(res2.statusCode).toBe(200);

    // Check DB for only one payment with that idempotencyKey
    const payments = await prisma.payment.findMany({ where: { idempotencyKey } });
    expect(payments.length).toBe(1);
  }, 20000);

  test('duplicate Stripe webhook delivery returns 200 and records a single PaymentEvent without reprocessing', async () => {
    const payment = await prisma.payment.create({
      data: {
        user: { connect: { id: testUserId } },
        amount: 999,
        currency: 'usd',
        planTier: 'pro',
        paymentMethodId: 'pm_test_webhook',
        stripePaymentIntentId: 'pi_test_webhook_dup',
        idempotencyKey: `webhook-${Date.now()}`,
        status: 'pending',
      },
    });

    const eventPayload = {
      id: 'evt_test_webhook_duplicate',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.stripePaymentIntentId,
          metadata: {
            paymentId: String(payment.id),
            idempotencyKey: payment.idempotencyKey,
          },
        },
      },
    };

    const res1 = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signWebhookPayload(eventPayload))
      .send(eventPayload);

    expect(res1.statusCode).toBe(200);

    const paymentAfterFirst = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(paymentAfterFirst.status).toBe('processed');

    const firstEvent = await prisma.paymentMethodEvent.findUnique({ where: { stripeEventId: eventPayload.id } });
    expect(firstEvent).not.toBeNull();
    expect(firstEvent.outcome).toBe('processed');
    expect(firstEvent.idempotencyKey).toBe(payment.idempotencyKey);

    const res2 = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signWebhookPayload(eventPayload))
      .send(eventPayload);

    expect(res2.statusCode).toBe(200);
    expect(res2.text).toMatch(/duplicate|ok/i);

    const paymentEvents = await prisma.paymentMethodEvent.findMany({ where: { stripeEventId: eventPayload.id } });
    expect(paymentEvents.length).toBe(1);

    const paymentAfterSecond = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(paymentAfterSecond.status).toBe('processed');

    const userAfter = await prisma.user.findUnique({ where: { id: payment.userId } });
    expect(userAfter.planTier).toBe('pro');
  }, 20000);
});
