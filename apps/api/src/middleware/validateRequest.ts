import type { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

export const validateRequest = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({
          error: 'Validation Error',
          details: error.message,
        });
      }
      return res.status(400).json({ error: 'Validation Error' });
    }
  };
};
