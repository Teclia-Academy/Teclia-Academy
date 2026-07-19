import { processStripeWebhook } from '../services/paymentService.js';

export const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const payload = req.body;

    const result = await processStripeWebhook({
      signature,
      payload,
      rawBody: payload,
    });

    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Payment webhook failed', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message || 'Webhook processing failed' });
  }
};
