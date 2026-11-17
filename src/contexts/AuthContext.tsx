import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest } from '../api/client.ts';

export type UserRole = 'salesman' | 'admin' | 'production' | 'accountant' | 'owner';

export interface AppUser {
  id: number;
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  dbUser: AppUser | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [dbUser, setDbUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncProfile = useCallback(async () => {
    try {
      setAuthError(null);
      const data = await apiRequest<{ user: AppUser }>('/api/auth/me');
      setDbUser(data.user);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to sync profile');
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await syncProfile();
      } else {
        setDbUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [syncProfile]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: any) {
      setAuthError(err.message || 'Google Sign-In failed');
    }
  };

  const logout = async () => {
    await signOut(auth);
    setDbUser(null);
  };

  const switchRole = async (role: UserRole) => {
    const data = await apiRequest<{ user: AppUser }>('/api/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    setDbUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        loading,
        authError,
        signInWithGoogle,
        logout,
        switchRole,
        refreshProfile: syncProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
