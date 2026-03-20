import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import cors from 'cors';
import archiver from 'archiver';
import { convertSubstackToMarkdown } from './convert.js';

import dotenv from 'dotenv';
dotenv.config();



const app = express();
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
app.use(express.json({ limit: '2mb' }));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const createTempOutputDir = async () =>
  fs.promises.mkdtemp(path.join(os.tmpdir(), 'substack-'));

const registerTempCleanup = (res, tempDir) => {
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Temp cleanup error:', err.message);
    }
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/convert', async (req, res) => {
  const { link } = req.body || {};
  if (!link || typeof link !== 'string') {
    res.status(400).json({ error: 'Missing Substack link.' });
    return;
  }

  try {
    const tempDir = await createTempOutputDir();
    registerTempCleanup(res, tempDir);
    const result = await convertSubstackToMarkdown(link, { writeFile: false, outputDir: tempDir });
    res.json({
      markdown: result.markdown,
      slug: result.postSlug,
      filename: result.mdFilename
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Conversion failed.' });
  }
});

app.post('/api/convert-zip', async (req, res) => {
  const { link, markdown } = req.body || {};
  if (!link || typeof link !== 'string') {
    res.status(400).json({ error: 'Missing Substack link.' });
    return;
  }

  try {
    const tempDir = await createTempOutputDir();
    registerTempCleanup(res, tempDir);
    const result = await convertSubstackToMarkdown(link, { writeFile: true, outputDir: tempDir });
    if (typeof markdown === 'string' && markdown.trim()) {
      const mdPath = path.join(result.postDir, result.mdFilename);
      fs.writeFileSync(mdPath, markdown, 'utf-8');
    }

    const zipName = `${result.postSlug || 'post'}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Zip error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip.' });
      } else {
        res.end();
      }
    });

    archive.pipe(res);
    archive.directory(result.postDir, result.postSlug || 'post');
    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message || 'Conversion failed.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Server error.' });
});

app.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Substack converter API running on http://${displayHost}:${port}`);
});
