import express from 'express';
import { handleWebhook } from '../controllers/paymentController.js';
import validate from '../middleware/validate.js';
import * as paymentSchemas from '../schemas/payment.schema.js';
import { createOrReusePayment } from '../services/paymentService.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// Raw body parsing for this route is applied centrally in app.js (before the
// global JSON parser) so Stripe's signature can be verified against the exact bytes.
router.post('/webhook', handleWebhook);

router.post(
  '/payment-method',
  verifyToken,
  validate(paymentSchemas.createPaymentMethod),
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const { paymentMethodId, planTier, idempotencyKey } = req.body;
      const headerKey = req.headers['idempotency-key'];

      const effectiveIdempotencyKey = headerKey || idempotencyKey;
      if (!effectiveIdempotencyKey) {
        return res.status(400).json({ error: 'idempotencyKey header or body field is required' });
      }

      const payment = await createOrReusePayment({
        userId,
        paymentMethodId,
        planTier,
        idempotencyKey: effectiveIdempotencyKey,
      });

      res.json({ paymentId: payment.id, stripePaymentIntentId: payment.stripePaymentIntentId, status: payment.status });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
