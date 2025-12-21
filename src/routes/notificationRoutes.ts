import { Router } from 'express';
import { NotificationController } from '../controllers/notificationController';

const router = Router();
const notificationController = new NotificationController();

/**
 * GET /api/notifications
 * Get all notifications (optionally unread only)
 */
router.get('/', notificationController.getNotifications);

/**
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
router.put('/:id/read', notificationController.markAsRead);

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all', notificationController.markAllAsRead);

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete('/:id', notificationController.deleteNotification);

/**
 * DELETE /api/notifications
 * Clear all notifications
 */
router.delete('/', notificationController.clearAll);

export default router;
