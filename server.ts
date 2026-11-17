import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './src/routes/auth.ts';
import mastersRoutes from './src/routes/masters.ts';
import purchasesRoutes from './src/routes/purchases.ts';
import inventoryRoutes from './src/routes/inventory.ts';
import productionRoutes from './src/routes/production.ts';
import ordersRoutes from './src/routes/orders.ts';
import invoicesRoutes from './src/routes/invoices.ts';
import paymentsRoutes from './src/routes/payments.ts';
import reportsRoutes from './src/routes/reports.ts';
import seedRoutes from './src/routes/seed.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/masters', mastersRoutes);
  app.use('/api/purchases', purchasesRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/production', productionRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/seed', seedRoutes);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Order-to-Audit ERP listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
