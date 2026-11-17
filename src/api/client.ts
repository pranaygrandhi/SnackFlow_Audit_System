import { auth } from '../lib/firebase.ts';

export async function getFreshToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return await user.getIdToken();
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getFreshToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as T;
}

export async function downloadAuthorizedFile(path: string, filename: string): Promise<void> {
  const token = await getFreshToken();
  const res = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let errMsg = `Download failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((paise || 0) / 100);
}

export function formatQty(val: string | number, decimals = 2): string {
  const num = Number(val || 0);
  if (Number.isInteger(num)) return num.toLocaleString('en-IN');
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
