import type { Request, Response } from 'express';
import { Router } from 'express';
import { NotificationService } from '../services/notificationService.js';

export const notificationRouter = Router();

notificationRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const channel = req.query.channel as string;
    const status = req.query.status as string;
    const limit = parseInt((req.query.limit as string) || '50', 10);

    const notifications = await NotificationService.list({
      userId,
      channel,
      status,
      limit,
    });

    return res.json({
      count: notifications.length,
      notifications,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

notificationRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const { userId, channel, recipient, template, data, subject, maxRetries, simulateFailure } =
      req.body;

    if (!channel || !recipient || !template || !data) {
      return res.status(400).json({ error: 'Missing required notification fields' });
    }

    const notification = await NotificationService.send({
      userId,
      channel,
      recipient,
      template,
      data,
      subject,
      maxRetries,
      simulateFailure,
    });

    return res.status(201).json({
      message: 'Notification processed',
      notification,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
