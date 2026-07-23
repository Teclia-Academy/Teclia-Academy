import Stripe from 'stripe';

let stripe;

const getStripeClient = () => {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      const error = new Error('STRIPE_SECRET_KEY is required');
      error.statusCode = 500;
      throw error;
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  }
  return stripe;
};

export const verifyStripeSignature = ({ signature, payload, rawBody }) => {
  if (!signature) {
    const error = new Error('Missing stripe-signature header');
    error.statusCode = 400;
    throw error;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    const error = new Error('STRIPE_WEBHOOK_SECRET is not configured');
    error.statusCode = 500;
    throw error;
  }

  const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || rawBody || '');

  try {
    return getStripeClient().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
};
