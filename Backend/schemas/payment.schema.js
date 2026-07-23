import { z } from 'zod';

export const createPaymentMethod = z.object({
  paymentMethodId: z.string().min(1, { message: 'paymentMethodId is required' }),
  planTier: z.enum(['basico', 'pro', 'master']),
  idempotencyKey: z.string().optional(),
});
