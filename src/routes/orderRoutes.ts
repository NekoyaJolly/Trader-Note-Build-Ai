import { Router } from 'express';
import { OrderController } from '../controllers/orderController';

const router = Router();
const orderController = new OrderController();

/**
 * GET /api/orders/preset/:noteId
 * Generate order preset based on a note
 */
router.get('/preset/:noteId', orderController.generatePreset);

/**
 * POST /api/orders/confirmation
 * Get order confirmation details
 */
router.post('/confirmation', orderController.getConfirmation);

export default router;
