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
const NEPAL_ONLY_ERROR = 'Sorry. This feature is currently unavailable due to traffic';
const GEO_CACHE_TTL_MS = 10 * 60 * 1000;
const geoCache = new Map();

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || req.ip || '';
  return rawIp.replace(/^::ffff:/, '');
};

const isPrivateIp = (ip) => {
  if (!ip) return true;
  if (ip === '::1') return true;
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('127.')) return true;
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
};

const fetchCountryForIp = async (ip) => {
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.country;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`https://ipapi.co/${ip}/country/`, {
      headers: { 'User-Agent': 'sub2mark-geo' },
      signal: controller.signal
    });
    if (!response.ok) return '';
    const country = (await response.text()).trim().toUpperCase();
    geoCache.set(ip, { country, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
    return country;
  } catch (err) {
    return '';
  } finally {
    clearTimeout(timeout);
  }
};

const isRequestFromNepal = async (req) => {
  const ip = getClientIp(req);
  if (!ip || isPrivateIp(ip)) return false;
  const country = await fetchCountryForIp(ip);
  return country === 'NP';
};

const ensureNepalAccess = async (req, res) => {
  const allowed = await isRequestFromNepal(req);
  if (!allowed) {
    res.status(403).json({ error: NEPAL_ONLY_ERROR });
    return false;
  }
  return true;
};

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

const deleteJobFiles = async (job) => {
  try {
    if (job.zipPath) {
      await fs.promises.rm(job.zipPath, { force: true });
    }
  } catch (err) {
    console.error('Zip cleanup error:', err.message);
  }
  try {
    if (job.tempDir) {
      await fs.promises.rm(job.tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Temp cleanup error:', err.message);
  }
  job.zipPath = '';
  job.tempDir = '';
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
    if (job.cancelRequested) {
      job.status = 'cancelled';
      await deleteJobFiles(job);
      scheduleJobCleanup(job.id);
      return;
    }
    job.status = 'running';
    for (const postLink of postLinks) {
      if (job.cancelRequested) {
        job.status = 'cancelled';
        await deleteJobFiles(job);
        scheduleJobCleanup(job.id);
        return;
      }
      await convertSubstackToMarkdown(postLink, { writeFile: true, outputDir: job.tempDir });
      job.converted += 1;
    }

    if (job.cancelRequested) {
      job.status = 'cancelled';
      await deleteJobFiles(job);
      scheduleJobCleanup(job.id);
      return;
    }

    job.status = 'zipping';
    job.zipPath = await createZipArchive(job.tempDir, job.zipRoot, job.id);
    if (job.cancelRequested) {
      job.status = 'cancelled';
      await deleteJobFiles(job);
      scheduleJobCleanup(job.id);
      return;
    }
    job.status = 'done';
    scheduleJobCleanup(job.id);
  } catch (err) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      await deleteJobFiles(job);
    } else {
      job.status = 'error';
      job.error = err.message || 'Conversion failed.';
    }
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

  if (!(await ensureNepalAccess(req, res))) {
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
      cleanupTimer: null,
      cancelRequested: false
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

app.post('/api/convert-all/stop/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    res.json({ status: job.status });
    return;
  }

  job.cancelRequested = true;
  job.status = 'cancelled';
  job.error = 'Conversion stopped.';
  scheduleJobCleanup(jobId);

  res.json({ status: job.status });
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

  if (!(await ensureNepalAccess(req, res))) {
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
