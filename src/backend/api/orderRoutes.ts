import { Router } from 'express';
import { OrderController } from '../controllers/orderController';
import { validateBody, validateParams } from '../../middleware/validateRequest';
import { OrderNoteIdParamSchema, OrderConfirmationRequestSchema } from '../../schemas/api/order';

const router = Router();
const orderController = new OrderController();

/**
 * GET /api/orders/preset/:noteId
 * Generate order preset based on a note
 */
router.get(
  '/preset/:noteId',
  validateParams(OrderNoteIdParamSchema),
  orderController.generatePreset
);

/**
 * POST /api/orders/confirmation
 * Get order confirmation details
 */
router.post(
  '/confirmation',
  validateBody(OrderConfirmationRequestSchema),
  orderController.getConfirmation
);

export default router;
