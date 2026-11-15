import { Router, Request, Response } from 'express';
import { requirePermission } from '../services/authorization';
import {
  applyMenuPublishWithBackup,
  exportMenuBundle,
  previewMenuPublish,
} from '../services/menu-publishing';

const router = Router();

function respondWithMenuPublishError(res: Response, error: any): Response {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) {
    res.locals.postHogError = error;
    console.error('[Menu Publishing] Operation failed:', error);
  }
  return res.status(statusCode).json({
    error: statusCode >= 500 ? 'Menu publishing failed' : error.message,
    ...(error?.code ? { code: error.code } : {}),
  });
}

router.get('/export', requirePermission('catalog.manage'), (_req: Request, res: Response) => {
  try {
    res.json(exportMenuBundle());
  } catch (error: any) {
    return respondWithMenuPublishError(res, error);
  }
});

router.post('/preview', requirePermission('catalog.manage'), (req: Request, res: Response) => {
  try {
    const userId = String((req as Request & { user?: { userId?: string } }).user?.userId || '');
    res.json(previewMenuPublish(req.body, userId));
  } catch (error: any) {
    return respondWithMenuPublishError(res, error);
  }
});

router.post(
  '/apply',
  requirePermission('catalog.manage'),
  async (req: Request, res: Response) => {
    try {
      const userId = String((req as Request & { user?: { userId?: string } }).user?.userId || '');
      const result = await applyMenuPublishWithBackup(req.body?.bundle, req.body?.preview_id, userId);
      res.json(result);
    } catch (error: any) {
      return respondWithMenuPublishError(res, error);
    }
  },
);

export const menuPublishingRoutes = router;
