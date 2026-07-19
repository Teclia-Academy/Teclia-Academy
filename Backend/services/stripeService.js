import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2024-06-20',
});

export const verifyStripeSignature = ({ signature, payload, rawBody }) => {
  if (!signature) {
    const error = new Error('Missing stripe-signature header');
    error.statusCode = 400;
    throw error;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
  const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || rawBody || '');

  try {
    return stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
};
