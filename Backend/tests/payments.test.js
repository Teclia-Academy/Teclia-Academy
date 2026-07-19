import request from 'supertest';
import Stripe from 'stripe';
import app from '../app.js';
import prisma from '../utils/prismaClient.js';
import { setupTestDb } from './helpers/db.setup.js';

setupTestDb();

const stripe = new Stripe('sk_test_123', {
  apiVersion: '2024-06-20',
});

const createSignedRequest = (payload, type, secret = 'whsec_test_secret') => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const header = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  });

  return {
    body,
    headers: {
      'stripe-signature': header,
      'content-type': 'application/json',
    },
  };
};

const createUser = async (email = 'webhook@example.com') => {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: 'hash',
      name: 'Webhook User',
      role: 'student',
      planTier: null,
    },
  });
};

describe('Stripe webhook sync', () => {
  it('processes checkout.session.completed and updates plan, role and subscription', async () => {
    const user = await createUser('checkout@example.com');
    const payload = {
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          customer_details: { email: user.email },
          metadata: { plan_tier: 'pro' },
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'checkout.session.completed');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser.planTier).toBe('pro');
    expect(updatedUser.role).toBe('premium');
    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(subscription).not.toBeNull();
    expect(subscription.status).toBe('active');
    const event = await prisma.paymentEvent.findUnique({ where: { externalId: 'evt_checkout_completed' } });
    expect(event).not.toBeNull();
    expect(event.eventType).toBe('checkout.session.completed');
  });

  it('processes invoice.paid and activates a paid subscription', async () => {
    const user = await createUser('invoice@example.com');
    const payload = {
      id: 'evt_invoice_paid',
      type: 'invoice.paid',
      data: {
        object: {
          customer_email: user.email,
          subscription: 'sub_invoice_paid',
          metadata: { plan_tier: 'master' },
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'invoice.paid');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser.planTier).toBe('master');
    expect(updatedUser.role).toBe('premium');
    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(subscription.status).toBe('active');
  });

  it('processes invoice.payment_failed and revokes access', async () => {
    const user = await createUser('failed@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { planTier: 'pro', role: 'premium' } });
    const payload = {
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer_email: user.email,
          subscription: 'sub_failed',
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'invoice.payment_failed');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser.planTier).toBeNull();
    expect(updatedUser.role).toBe('student');
    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(subscription.status).toBe('past_due');
  });

  it('processes customer.subscription.updated and keeps the last state in sync', async () => {
    const user = await createUser('updated@example.com');
    const payload = {
      id: 'evt_subscription_updated',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_updated_1',
          customer_email: user.email,
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: 1760000000,
          items: {
            data: [{ price: { metadata: { plan_tier: 'basico' } } }],
          },
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'customer.subscription.updated');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser.planTier).toBe('basico');
    expect(updatedUser.role).toBe('premium');
  });

  it('processes customer.subscription.deleted and revokes access', async () => {
    const user = await createUser('deleted@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { planTier: 'pro', role: 'premium' } });
    const payload = {
      id: 'evt_subscription_deleted',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_deleted_1',
          customer_email: user.email,
          status: 'canceled',
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'customer.subscription.deleted');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser.planTier).toBeNull();
    expect(updatedUser.role).toBe('student');
  });

  it('rejects webhooks with invalid signature', async () => {
    const payload = {
      id: 'evt_invalid',
      type: 'checkout.session.completed',
      data: { object: { customer_details: { email: 'invalid@example.com' } } },
    };

    const body = JSON.stringify(payload);
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('stripe-signature', 'bad-signature')
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 for duplicate webhook events without reprocessing', async () => {
    const user = await createUser('duplicate@example.com');
    const payload = {
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_dupe',
          customer_details: { email: user.email },
          metadata: { plan_tier: 'basico' },
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'checkout.session.completed');
    const first = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    const second = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const events = await prisma.paymentEvent.findMany({ where: { externalId: 'evt_duplicate' } });
    expect(events).toHaveLength(1);
  });

  it('stores an audit record and keeps a single processed entry for the same external event', async () => {
    const user = await createUser('audit@example.com');
    const payload = {
      id: 'evt_audit_only',
      type: 'invoice.paid',
      data: {
        object: {
          customer_email: user.email,
          subscription: 'sub_audit_only',
          metadata: { plan_tier: 'pro' },
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'invoice.paid');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const auditEvents = await prisma.paymentEvent.findMany({ where: { externalId: 'evt_audit_only' } });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].eventType).toBe('invoice.paid');
    expect(auditEvents[0].status).toBe('processed');
    expect(auditEvents[0].payload).toContain('evt_audit_only');
  });

  it('accepts a signed webhook end to end and updates the user state and audit trail', async () => {
    const user = await createUser('final@example.com');
    const payload = {
      id: 'evt_full_flow',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_full_flow',
          customer_details: { email: user.email },
          metadata: { plan_tier: 'master' },
        },
      },
    };

    const { body, headers } = createSignedRequest(payload, 'checkout.session.completed');
    const res = await request(app)
      .post('/api/payments/webhook')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser.planTier).toBe('master');
    expect(updatedUser.role).toBe('premium');
    const subscriptionRecord = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(subscriptionRecord).not.toBeNull();
    expect(subscriptionRecord.status).toBe('active');
    const auditRecord = await prisma.paymentEvent.findUnique({ where: { externalId: 'evt_full_flow' } });
    expect(auditRecord).not.toBeNull();
    expect(auditRecord.status).toBe('processed');
  });
});
