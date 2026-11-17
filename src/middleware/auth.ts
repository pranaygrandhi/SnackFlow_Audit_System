import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { count, eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

export type UserRole = 'salesman' | 'admin' | 'production' | 'accountant' | 'owner';

export interface DbUser {
  id: number;
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: DbUser;
}

async function getOrCreateDbUser(decoded: DecodedIdToken): Promise<DbUser> {
  const email = decoded.email || `${decoded.uid}@user.local`;
  const name = decoded.name || email.split('@')[0] || 'Operator';

  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.uid, decoded.uid))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      return {
        ...row,
        role: row.role as UserRole,
      };
    }

    const totalUsersResult = await db.select({ value: count() }).from(users);
    const isFirstUser = Number(totalUsersResult[0]?.value ?? 0) === 0;
    const initialRole: UserRole = isFirstUser ? 'owner' : 'owner';

    const inserted = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        name,
        email,
        role: initialRole,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email, name },
      })
      .returning();

    const row = inserted[0];
    return {
      ...row,
      role: row.role as UserRole,
    };
  } catch (error) {
    console.error('Database error syncing user profile:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split('Bearer ')[1];
  } else if (typeof req.query.token === 'string' && req.query.token.length > 0) {
    // Allow token via query param specifically for direct PDF/CSV browser download links
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    req.dbUser = await getOrCreateDbUser(decodedToken);
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.dbUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.dbUser.role)) {
      return res.status(403).json({
        error: `Access denied for role '${req.dbUser.role}'. Required: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
};
