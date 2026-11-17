import { Router } from 'express';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import { ensureBenchmarkSeed } from '../services/seedService.ts';

const router = Router();

router.post('/benchmark-reset', requireAuth, requireRole(['owner', 'admin']), async (req: AuthRequest, res) => {
  try {
    await ensureBenchmarkSeed(req.dbUser!.id, true);
    res.json({ reset: true, message: 'Database reset to Section 5 Benchmark Opening State' });
  } catch (error) {
    console.error('Failed to reset benchmark state:', error);
    res.status(500).json({ error: 'Failed to reset benchmark data' });
  }
});

export default router;
