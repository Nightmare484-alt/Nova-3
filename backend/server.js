// NOVA — Neural Operations Virtual Assistant
// Backend entry point.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';

import chatRouter from './routes/chat.js';
import mediaRouter from './routes/media.js';
import toolRouter from './routes/tool.js';
import { errorHandler, notFound } from './middleware/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Soft rate limit on the API to protect quota
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' }
  })
);

// Static frontend
app.use(
  express.static(path.join(__dirname, '..', 'frontend'), {
    extensions: ['html'],
    maxAge: '1h'
  })
);

// Health
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'nova',
    model: process.env.GEMINI_MODEL || null,
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString()
  });
});

// API routes
app.use('/api', chatRouter);
app.use('/api', mediaRouter);
app.use('/api', toolRouter);

// SPA fallback for non-API routes
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  const configured = process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL;
  console.log('');
  console.log('  ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ');
  console.log('  ████╗  ██║██╔═══██╗██║   ██║██╔══██╗');
  console.log('  ██╔██╗ ██║██║   ██║██║   ██║███████║');
  console.log('  ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║');
  console.log('  ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║');
  console.log('  ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝');
  console.log('');
  console.log(`  NOVA online  →  http://localhost:${PORT}`);
  console.log(`  Model        →  ${process.env.GEMINI_MODEL || '(not set)'}`);
  console.log(`  Gemini key   →  ${configured ? 'configured ✓' : 'MISSING ✗  (set GEMINI_API_KEY + GEMINI_MODEL in .env)'}`);
  console.log('');
});
