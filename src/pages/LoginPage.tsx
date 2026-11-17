import React from 'react';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';

export function LoginPage() {
  const { signInWithGoogle, authError } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <div className="mb-6">
          <div className="text-xs font-medium text-amber-700 mb-2">
            Tiruchirappalli Food Manufacturing ERP
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Kaveri Crunch Order-to-Audit
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Unified ledger for field orders, BOM production runs, FIFO raw material costing, GST invoicing, and monthly auditor registers.
          </p>
        </div>

        <div className="border-t border-slate-100 pt-6 space-y-4">
          <div className="flex items-start gap-3 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Protected by Firebase Authentication and PostgreSQL ACID ledger transactions with role-based access control.
            </span>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {authError}
            </div>
          )}

          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors min-h-[44px]"
          >
            <span>Sign in with Google</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
