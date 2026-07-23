import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

// Note: route should be mounted with raw body parsing middleware in server.js
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const rawBody = req.body;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (webhookSecret && !sig) {
    console.warn('Missing Stripe signature header');
    return res.status(400).send('missing signature');
  }

  if (webhookSecret) {
    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);
    const signatureHeader = String(sig);
    const parts = signatureHeader.split(',');
    const timestampPart = parts.find((part) => part.startsWith('t='));
    const v1Part = parts.find((part) => part.startsWith('v1='));
    const timestamp = timestampPart ? timestampPart.slice(2) : null;
    const signature = v1Part ? v1Part.slice(3) : null;

    if (!timestamp || !signature) {
      console.warn('Invalid Stripe signature format');
      return res.status(400).send('invalid signature');
    }

    const signedPayload = `${timestamp}.${payload}`;
    const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      console.warn('Stripe webhook signature verification failed');
      return res.status(400).send('invalid signature');
    }
  }

  // Minimal verification: use stripeEventId uniqueness and idempotent processing.
  try {
    let parsed = rawBody;
    if (Buffer.isBuffer(rawBody)) parsed = rawBody.toString('utf8');
    const event = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    const stripeEventId = event?.id;
    const eventType = event?.type;
    const paymentIntent = event.data?.object;
    const idempotencyKey = paymentIntent?.metadata?.idempotencyKey;

    if (!stripeEventId) {
      console.warn('stripe webhook missing id');
      return res.status(200).send('ok');
    }

    // Try to create a PaymentEvent record - unique constraint on stripeEventId prevents duplicates
    try {
      await prisma.paymentMethodEvent.create({ data: {
        stripeEventId,
        eventType,
        idempotencyKey,
        payload: JSON.stringify(event),
        outcome: 'processing',
      }});
    } catch (err) {
      // Duplicate — already processed or in-flight
      console.info({
        stripeEventId,
        eventType,
        idempotencyKey,
        outcome: 'duplicate',
        timestamp: new Date().toISOString(),
      }, 'duplicate webhook delivery');
      return res.status(200).send('duplicate');
    }

    if (eventType === 'payment_intent.succeeded') {
      const paymentIntent = event.data?.object;
      const stripeId = paymentIntent?.id;
      const metadata = paymentIntent?.metadata || {};

      // Find associated payment
      const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: stripeId } });
      if (payment && payment.status === 'processed') {
        await prisma.paymentMethodEvent.updateMany({ where: { stripeEventId }, data: { outcome: 'duplicate', processedAt: new Date() } });
        console.info({
          userId: payment.userId,
          paymentId: payment.id,
          stripeEventId,
          eventType,
          idempotencyKey,
          outcome: 'duplicate',
          timestamp: new Date().toISOString(),
        }, 'duplicate webhook event for processed payment');
        return res.status(200).send('ok');
      }

      try {
        await prisma.$transaction(async (tx) => {
          let p = payment;
          if (!p) {
            // Try to find by metadata paymentId
            const metaPaymentId = parseInt(String(metadata?.paymentId || ''), 10) || null;
            if (metaPaymentId) p = await tx.payment.findUnique({ where: { id: metaPaymentId } });
          }

          if (!p) {
            await tx.paymentMethodEvent.updateMany({ where: { stripeEventId }, data: { outcome: 'failed', processedAt: new Date() } });
            return;
          }

          await tx.payment.update({ where: { id: p.id }, data: { status: 'processed' } });
          await tx.user.update({ where: { id: p.userId }, data: { planTier: p.planTier } });
          await tx.paymentMethodEvent.updateMany({ where: { stripeEventId }, data: { paymentId: p.id, outcome: 'processed', processedAt: new Date() } });
          console.info({
            userId: p.userId,
            paymentId: p.id,
            stripeEventId,
            eventType,
            idempotencyKey,
            outcome: 'processed',
            timestamp: new Date().toISOString(),
          }, 'processed webhook event');
        });
      } catch (err) {
        console.error('Failed processing webhook:', err);
        await prisma.paymentMethodEvent.updateMany({ where: { stripeEventId }, data: { outcome: 'failed', processedAt: new Date() } });
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Invalid webhook payload', err);
    res.status(200).send('ok');
  }
});

export default router;
