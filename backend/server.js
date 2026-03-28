import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
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

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml,application/xml,text/xml,*/*',
  'Accept-Language': 'en-US,en;q=0.9'
};

const normalizeUrl = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`;
};

const isPostUrl = (value) => {
  try {
    const url = new URL(normalizeUrl(value));
    return /\/p\/[^/?#]+/i.test(url.pathname);
  } catch {
    return false;
  }
};

const safeSlug = (value) => {
  const replaced = String(value || '')
    .replace(/\s+/g, '-')
    .trim();
  const cleaned = replaced.replace(/[<>:"/\\|?*]/g, '').replace(/-+/g, '-');
  return cleaned.replace(/^-+|-+$/g, '');
};

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');

const buildFeedUrl = (siteUrl) => `${stripTrailingSlash(siteUrl)}/feed`;

const extractRssLinks = (rssText) => {
  if (!rssText) return [];
  const items = rssText.match(/<item[\s\S]*?<\/item>/gi) || [];
  const links = new Set();

  const extractTag = (itemText, tagName) => {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = itemText.match(regex);
    if (!match) return '';
    return match[1]
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .trim();
  };

  for (const item of items) {
    const link = extractTag(item, 'link') || extractTag(item, 'guid');
    if (link && isPostUrl(link)) {
      links.add(link);
    }
  }

  return Array.from(links);
};

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

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

const cleanupJob = async (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.delete(jobId);
  try {
    if (job.zipPath) {
      await fs.promises.rm(job.zipPath, { force: true });
    }
    if (job.tempDir) {
      await fs.promises.rm(job.tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Job cleanup error:', err.message);
  }
};

const scheduleJobCleanup = (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
  }
  job.cleanupTimer = setTimeout(() => cleanupJob(jobId), JOB_TTL_MS);
};

const createZipArchive = async (sourceDir, zipRoot, jobId) => {
  const zipPath = path.join(os.tmpdir(), `substack-${zipRoot}-${jobId}.zip`);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, zipRoot);
    archive.finalize();
  });
  return zipPath;
};

const runConvertAllJob = async (job, postLinks) => {
  try {
    job.status = 'running';
    for (const postLink of postLinks) {
      await convertSubstackToMarkdown(postLink, { writeFile: true, outputDir: job.tempDir });
      job.converted += 1;
    }

    job.status = 'zipping';
    job.zipPath = await createZipArchive(job.tempDir, job.zipRoot, job.id);
    job.status = 'done';
    scheduleJobCleanup(job.id);
  } catch (err) {
    job.status = 'error';
    job.error = err.message || 'Conversion failed.';
    scheduleJobCleanup(job.id);
  }
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
  if (!isPostUrl(link)) {
    res.status(400).json({ error: 'Please provide a single post URL (it should include /p/).' });
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
  if (!isPostUrl(link)) {
    res.status(400).json({ error: 'Please provide a single post URL (it should include /p/).' });
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

app.post('/api/convert-all/start', async (req, res) => {
  const { link } = req.body || {};
  if (!link || typeof link !== 'string') {
    res.status(400).json({ error: 'Missing Substack link.' });
    return;
  }

  if (isPostUrl(link)) {
    res
      .status(400)
      .json({ error: 'Please provide the main Substack URL (not a single post link).' });
    return;
  }

  try {
    const normalized = normalizeUrl(link);
    const parsedUrl = new URL(normalized);
    const siteRoot = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const feedUrl = buildFeedUrl(siteRoot);

    const feedResponse = await fetch(feedUrl, {
      headers: DEFAULT_HEADERS,
      redirect: 'follow'
    });

    if (!feedResponse.ok) {
      throw new Error(`Failed to load RSS feed from ${feedUrl}: ${feedResponse.statusText}`);
    }

    const feedText = await feedResponse.text();
    const postLinks = extractRssLinks(feedText);

    if (!postLinks.length) {
      throw new Error('No post links found in the RSS feed.');
    }

    const tempDir = await createTempOutputDir();
    const baseHost = parsedUrl.hostname.replace(/^www\./i, '');
    const zipRoot = safeSlug(baseHost) || 'substack';
    const zipName = `${zipRoot}.zip`;
    const jobId = crypto.randomUUID();

    const job = {
      id: jobId,
      status: 'queued',
      converted: 0,
      total: postLinks.length,
      tempDir,
      zipRoot,
      zipName,
      zipPath: '',
      error: '',
      cleanupTimer: null
    };

    jobs.set(jobId, job);
    setImmediate(() => runConvertAllJob(job, postLinks));

    res.json({ jobId, total: job.total, zipName });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Conversion failed.' });
  }
});

app.get('/api/convert-all/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json({
    status: job.status,
    converted: job.converted,
    total: job.total,
    zipName: job.zipName,
    error: job.error
  });
});

app.get('/api/convert-all/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (job.status !== 'done' || !job.zipPath) {
    res.status(409).json({ error: 'Zip is not ready yet.' });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${job.zipName}"`);

  const stream = fs.createReadStream(job.zipPath);
  stream.on('error', (err) => {
    console.error('Zip stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read zip.' });
    } else {
      res.end();
    }
  });

  res.on('finish', () => cleanupJob(jobId));
  res.on('close', () => cleanupJob(jobId));

  stream.pipe(res);
});

app.post('/api/convert-all', async (req, res) => {
  const { link } = req.body || {};
  if (!link || typeof link !== 'string') {
    res.status(400).json({ error: 'Missing Substack link.' });
    return;
  }

  if (isPostUrl(link)) {
    res
      .status(400)
      .json({ error: 'Please provide the main Substack URL (not a single post link).' });
    return;
  }

  try {
    const tempDir = await createTempOutputDir();
    registerTempCleanup(res, tempDir);

    const normalized = normalizeUrl(link);
    const parsedUrl = new URL(normalized);
    const siteRoot = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const feedUrl = buildFeedUrl(siteRoot);

    const feedResponse = await fetch(feedUrl, {
      headers: DEFAULT_HEADERS,
      redirect: 'follow'
    });

    if (!feedResponse.ok) {
      throw new Error(`Failed to load RSS feed from ${feedUrl}: ${feedResponse.statusText}`);
    }

    const feedText = await feedResponse.text();
    const postLinks = extractRssLinks(feedText);

    if (!postLinks.length) {
      throw new Error('No post links found in the RSS feed.');
    }

    for (const postLink of postLinks) {
      await convertSubstackToMarkdown(postLink, { writeFile: true, outputDir: tempDir });
    }

    const baseHost = parsedUrl.hostname.replace(/^www\./i, '');
    const zipRoot = safeSlug(baseHost) || 'substack';
    const zipName = `${zipRoot}.zip`;

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
    archive.directory(tempDir, zipRoot);
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
