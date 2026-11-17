import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole, UserRole } from '../middleware/auth.ts';
import { ensureBenchmarkSeed } from '../services/seedService.ts';

const router = Router();
const VALID_ROLES: UserRole[] = ['salesman', 'admin', 'production', 'accountant', 'owner'];

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    await ensureBenchmarkSeed(user.id, false);
    res.json({ user });
  } catch (error) {
    console.error('Error in /api/auth/me:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Allows the primary workspace owner (user id 1 or current owner) to switch role perspective for end-to-end RBAC & workflow testing
router.post('/switch-role', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { role } = req.body as { role?: UserRole };
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role specified' });
    }

    const currentUser = req.dbUser!;
    // Primary workspace operator (id === 1) or current owner can switch perspectives
    if (currentUser.id !== 1 && currentUser.role !== 'owner') {
      return res.status(403).json({ error: 'Only workspace owner can switch operational roles' });
    }

    const [updated] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, currentUser.id))
      .returning();

    res.json({ user: updated });
  } catch (error) {
    console.error('Failed to switch role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

router.get('/team', requireAuth, requireRole(['owner', 'admin']), async (_req, res) => {
  try {
    const team = await db.select().from(users).orderBy(asc(users.id));
    res.json({ team });
  } catch (error) {
    console.error('Failed to list team:', error);
    res.status(500).json({ error: 'Failed to load team list' });
  }
});

export default router;
