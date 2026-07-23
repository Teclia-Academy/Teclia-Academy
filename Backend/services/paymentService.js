import prisma from '../utils/prismaClient.js';
import { verifyStripeSignature } from './stripeService.js';
import https from 'https';

const normalizePlan = (planTier) => {
  if (!planTier) return null;
  const normalized = String(planTier).toLowerCase();
  return ['basico', 'pro', 'master'].includes(normalized) ? normalized : null;
};

const buildRole = (planTier) => (planTier ? 'premium' : 'student');

const findUserByEmail = async (email) => {
  if (!email) return null;
  return prisma.user.findFirst({ where: { email: { equals: String(email).trim().toLowerCase() } } });
};

const createAuditEvent = async ({ event, eventType, status = 'ignored', userId = null, attemptCount = 1 }) => {
  const existing = await prisma.paymentEvent.findUnique({ where: { externalId: event.id } });
  if (existing) return existing;

  return prisma.paymentEvent.create({
    data: {
      externalId: event.id,
      eventType,
      payload: JSON.stringify(event),
      status,
      processedAt: new Date(),
      userId,
      attemptCount,
    },
  });
};

const updateUserSubscriptionState = async ({ userId, planTier, role, subscriptionData, event, eventType }) => {
  const normalizedPlan = normalizePlan(planTier);
  const normalizedRole = buildRole(normalizedPlan);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const transaction = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        role: normalizedRole,
        planTier: normalizedPlan,
      },
    });

    await tx.subscription.upsert({
      where: { userId },
      update: {
        stripeId: subscriptionData?.stripeId || null,
        status: subscriptionData?.status || 'active',
        planTier: normalizedPlan,
        currentPeriodEnd: subscriptionData?.currentPeriodEnd || null,
        cancelAtPeriodEnd: subscriptionData?.cancelAtPeriodEnd ?? false,
      },
      create: {
        userId,
        stripeId: subscriptionData?.stripeId || null,
        status: subscriptionData?.status || 'active',
        planTier: normalizedPlan,
        currentPeriodEnd: subscriptionData?.currentPeriodEnd || null,
        cancelAtPeriodEnd: subscriptionData?.cancelAtPeriodEnd ?? false,
      },
    });

    const existingEvent = await tx.paymentEvent.findUnique({ where: { externalId: event.id } });
    if (existingEvent) {
      return { updatedUser, existingEvent };
    }

    const paymentEvent = await tx.paymentEvent.create({
      data: {
        externalId: event.id,
        eventType,
        payload: JSON.stringify(event),
        status: 'processed',
        processedAt: new Date(),
        userId,
        attemptCount: 1,
      },
    });

    return { updatedUser, paymentEvent };
  });

  return transaction;
};

const handleCheckoutCompleted = async (event) => {
  const session = event.data?.object || {};
  const email = session?.customer_details?.email || session?.customer_email || null;
  const planTier = session?.metadata?.plan_tier || session?.metadata?.planTier || null;
  const user = await findUserByEmail(email);
  if (!user) {
    await createAuditEvent({ event, eventType: event.type, status: 'ignored' });
    return { statusCode: 200, body: { received: true, ignored: true } };
  }

  await updateUserSubscriptionState({
    userId: user.id,
    planTier,
    role: buildRole(normalizePlan(planTier)),
    subscriptionData: {
      stripeId: session.subscription || null,
      status: 'active',
      planTier: normalizePlan(planTier),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    event,
    eventType: event.type,
  });

  return { statusCode: 200, body: { received: true, processed: true } };
};

const handleInvoicePaid = async (event) => {
  const invoice = event.data?.object || {};
  const email = invoice?.customer_email || invoice?.customer?.email || null;
  const planTier = invoice?.metadata?.plan_tier || invoice?.metadata?.planTier || null;
  const user = await findUserByEmail(email);
  if (!user) {
    await createAuditEvent({ event, eventType: event.type, status: 'ignored' });
    return { statusCode: 200, body: { received: true, ignored: true } };
  }

  await updateUserSubscriptionState({
    userId: user.id,
    planTier,
    role: buildRole(normalizePlan(planTier)),
    subscriptionData: {
      stripeId: invoice.subscription || null,
      status: 'active',
      planTier: normalizePlan(planTier),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    event,
    eventType: event.type,
  });

  return { statusCode: 200, body: { received: true, processed: true } };
};

const handleInvoicePaymentFailed = async (event) => {
  const invoice = event.data?.object || {};
  const email = invoice?.customer_email || invoice?.customer?.email || null;
  const user = await findUserByEmail(email);
  if (!user) {
    await createAuditEvent({ event, eventType: event.type, status: 'ignored' });
    return { statusCode: 200, body: { received: true, ignored: true } };
  }

  await updateUserSubscriptionState({
    userId: user.id,
    planTier: null,
    role: 'student',
    subscriptionData: {
      stripeId: invoice.subscription || null,
      status: 'past_due',
      planTier: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    event,
    eventType: event.type,
  });

  return { statusCode: 200, body: { received: true, processed: true } };
};

const handleSubscriptionUpdated = async (event) => {
  const subscription = event.data?.object || {};
  const email = subscription?.customer_email || subscription?.customer?.email || null;
  const planTier = subscription?.items?.data?.[0]?.price?.metadata?.plan_tier || subscription?.items?.data?.[0]?.price?.metadata?.planTier || null;
  const user = await findUserByEmail(email);
  if (!user) {
    await createAuditEvent({ event, eventType: event.type, status: 'ignored' });
    return { statusCode: 200, body: { received: true, ignored: true } };
  }

  await updateUserSubscriptionState({
    userId: user.id,
    planTier,
    role: buildRole(normalizePlan(planTier)),
    subscriptionData: {
      stripeId: subscription.id || null,
      status: subscription.status || 'active',
      planTier: normalizePlan(planTier),
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    },
    event,
    eventType: event.type,
  });

  return { statusCode: 200, body: { received: true, processed: true } };
};

const handleSubscriptionDeleted = async (event) => {
  const subscription = event.data?.object || {};
  const email = subscription?.customer_email || subscription?.customer?.email || null;
  const user = await findUserByEmail(email);
  if (!user) {
    await createAuditEvent({ event, eventType: event.type, status: 'ignored' });
    return { statusCode: 200, body: { received: true, ignored: true } };
  }

  await updateUserSubscriptionState({
    userId: user.id,
    planTier: null,
    role: 'student',
    subscriptionData: {
      stripeId: subscription.id || null,
      status: 'canceled',
      planTier: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    event,
    eventType: event.type,
  });

  return { statusCode: 200, body: { received: true, processed: true } };
};

const eventHandlers = {
  'checkout.session.completed': handleCheckoutCompleted,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
};

export const processStripeWebhook = async ({ signature, payload, rawBody }) => {
  const event = verifyStripeSignature({ signature, payload, rawBody });

  const existing = await prisma.paymentEvent.findUnique({ where: { externalId: event.id } });
  if (existing) {
    return { statusCode: 200, body: { received: true, duplicate: true } };
  }

  const handler = eventHandlers[event.type];
  if (!handler) {
    await prisma.paymentEvent.create({
      data: {
        externalId: event.id,
        eventType: event.type,
        payload: JSON.stringify(event),
        status: 'ignored',
        processedAt: new Date(),
        attemptCount: 1,
      },
    });
    return { statusCode: 200, body: { received: true, ignored: true } };
  }

  const result = await handler(event);
  return result;
};

const STRIPE_API_BASE = 'api.stripe.com';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';

const stripeRequest = ({ path, method = 'POST', body, idempotencyKey }) => new Promise((resolve, reject) => {
  const data = new URLSearchParams(body).toString();
  const options = {
    hostname: STRIPE_API_BASE,
    path,
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(data),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  };

  const req = https.request(options, (res) => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { raw += chunk; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(raw);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(parsed);
        }
      } catch (err) {
        reject(err);
      }
    });
  });

  req.on('error', (err) => reject(err));
  req.write(data);
  req.end();
});

export async function createOrReusePayment({ userId, paymentMethodId, planTier, idempotencyKey }) {
  if (!idempotencyKey) throw new Error('idempotencyKey required');

  // Minimal plan to amount mapping (USD cents)
  const PLAN_AMOUNTS = { basico: 999, pro: 2499, master: 4999 };
  const amount = PLAN_AMOUNTS[planTier] ?? 0;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey } }).catch(() => null);
    if (existing) return existing;

    const payment = await tx.payment.create({
      data: {
        userId,
        amount,
        currency: 'usd',
        planTier,
        paymentMethodId,
        idempotencyKey,
        status: 'pending',
      },
    });

    // Create PaymentIntent at Stripe using idempotency key
    try {
      if (process.env.NODE_ENV === 'test') {
        const stripeId = `test_pi_${payment.id}_${Date.now()}`;
        const updated = await tx.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: stripeId } });
        return updated;
      }

      const body = {
        amount: String(amount),
        currency: 'usd',
        payment_method: paymentMethodId,
        confirm: 'true',
        'metadata[paymentId]': String(payment.id),
        'metadata[idempotencyKey]': idempotencyKey,
      };

      const res = await stripeRequest({ path: '/v1/payment_intents', body, idempotencyKey });
      const stripeId = res.id;

      const updated = await tx.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: stripeId } });
      console.info({
        userId,
        paymentId: updated.id,
        stripePaymentIntentId: stripeId,
        idempotencyKey,
        outcome: 'processed',
        timestamp: new Date().toISOString(),
      }, 'Stripe payment intent created');

      return updated;
    } catch (err) {
      // Leave payment as pending/failed depending on error
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed' } }).catch(() => {});
      throw err;
    }
  });
}

export async function markPaymentProcessed({ paymentId }) {
  return prisma.payment.update({ where: { id: paymentId }, data: { status: 'processed' } });
}

export default { createOrReusePayment, markPaymentProcessed };
