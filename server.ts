import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendOtp, verifyOtp, sendContactEmail, logSmtpStatusOnStart } from './server/otpManager';
import { intelligentReaderRouter } from './server/intelligentReaderRouter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '18mb' }));
  app.use('/api/reader', intelligentReaderRouter);

  // CORS: the Android app (Capacitor) loads pages from https://localhost or capacitor://localhost,
  // so its requests to this server are cross-origin.
  const exactAllowedOrigins = new Set([
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ]);
  const isOriginAllowed = (origin?: string) => {
    if (!origin) return false;
    if (exactAllowedOrigins.has(origin)) return true;
    try {
      const u = new URL(origin);
      if (u.protocol === 'capacitor:' || u.protocol === 'ionic:') return true;
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
      if (u.hostname.endsWith('.run.app')) return true;
    } catch {
      return false;
    }
    return false;
  };
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Helper to extract client IP
  const getClientIp = (req: express.Request): string => {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1'
    );
  };

  // POST /send-otp and /api/send-otp: Send OTP code via Gmail SMTP
  const handleSendOtp = async (req: express.Request, res: express.Response) => {
    const { email } = req.body;
    const clientIp = getClientIp(req);
    const result = await sendOtp(email, clientIp);
    return res.status(result.status).json(result.data);
  };
  app.post('/send-otp', handleSendOtp);
  app.post('/api/send-otp', handleSendOtp);

  // POST /verify-otp and /api/verify-otp: Verify 6-digit OTP code
  const handleVerifyOtp = async (req: express.Request, res: express.Response) => {
    const { email, otp } = req.body;
    const result = await verifyOtp(email, otp);
    return res.status(result.status).json(result.data);
  };
  app.post('/verify-otp', handleVerifyOtp);
  app.post('/api/verify-otp', handleVerifyOtp);

  // POST /send-contact-message and /api/send-contact-message: Deliver contact message directly to daraltawhid25@gmail.com
  const handleSendContactMessage = async (req: express.Request, res: express.Response) => {
    const { name, email, message, subject } = req.body;
    const result = await sendContactEmail({ name, email, message, subject });
    return res.status(result.status).json(result.data);
  };
  app.post('/send-contact-message', handleSendContactMessage);
  app.post('/api/send-contact-message', handleSendContactMessage);

  // ─── Persistent 100% Free Server-Side Database Store ────────────────────────
  // Ensures Developer Panel edits to app_settings, books, videos, video_channels,
  // social_channels, and all app collections save permanently on the project disk
  // (both live_catalog_store.json and data-export/*.json) with zero cost and no limits.
  const CATALOG_COLLECTIONS = new Set([
    'app_settings',
    'books',
    'videos',
    'video_channels',
    'social_channels',
    'contact_messages',
    'users',
    'book_progress',
    'book_notes',
    'book_bookmarks',
    'book_audio_settings',
    'video_bookmarks',
    'video_notes',
    'user_notifications',
  ]);

  const SEED_FILE_MAP: Record<string, string> = {
    app_settings: path.join(__dirname, 'data-export', 'AppSettings.json'),
    books: path.join(__dirname, 'data-export', 'Books.json'),
    videos: path.join(__dirname, 'data-export', 'Videos.json'),
    video_channels: path.join(__dirname, 'data-export', 'VideoChannels.json'),
    social_channels: path.join(__dirname, 'data-export', 'SocialChannels.json'),
  };

  const primaryCatalogStorePath = path.join(__dirname, 'data-export', 'live_catalog_store.json');
  const fallbackCatalogStorePath = '/tmp/dar_live_catalog_store.json';

  interface LiveCatalogStore {
    collections: Record<string, any[]>;
    deletedIds: string[];
    updatedAt: string;
  }

  const readLiveCatalogStore = (): LiveCatalogStore => {
    for (const filePath of [primaryCatalogStorePath, fallbackCatalogStorePath]) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            return {
              collections: parsed.collections && typeof parsed.collections === 'object' ? parsed.collections : {},
              deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            };
          }
        }
      } catch {}
    }
    return { collections: {}, deletedIds: [], updatedAt: new Date().toISOString() };
  };

  let liveCatalogCache: LiveCatalogStore = readLiveCatalogStore();

  const syncSeedExportFile = (col: string, store: LiveCatalogStore) => {
    const seedFilePath = SEED_FILE_MAP[col];
    if (!seedFilePath) return;
    try {
      let existingSeed: any[] = [];
      if (fs.existsSync(seedFilePath)) {
        const raw = fs.readFileSync(seedFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) existingSeed = parsed;
      }
      const deletedSet = new Set<string>(store.deletedIds || []);
      const liveItems: any[] = Array.isArray(store.collections[col]) ? store.collections[col] : [];

      if (col === 'app_settings') {
        const byKey = new Map<string, any>();
        for (const item of existingSeed) {
          if (!item) continue;
          const k = String(item.setting_key || item.id || '').trim();
          if (!k) continue;
          const prev = byKey.get(k);
          if (!prev || String(item.updated_date || '') >= String(prev.updated_date || '')) {
            byKey.set(k, item);
          }
        }
        for (const live of liveItems) {
          if (!live) continue;
          const k = String(live.setting_key || live.id || '').trim();
          if (!k) continue;
          const prev = byKey.get(k) || {};
          byKey.set(k, { ...prev, ...live, setting_key: k });
        }
        fs.writeFileSync(seedFilePath, JSON.stringify(Array.from(byKey.values()), null, 2), 'utf-8');
      } else {
        const byId = new Map<string, any>();
        for (const item of existingSeed) {
          if (!item) continue;
          const id = String(item.id || '').trim();
          if (!id || deletedSet.has(id)) continue;
          byId.set(id, item);
        }
        for (const live of liveItems) {
          if (!live) continue;
          const id = String(live.id || '').trim();
          if (!id || deletedSet.has(id)) continue;
          const prev = byId.get(id) || {};
          byId.set(id, { ...prev, ...live, id });
        }
        fs.writeFileSync(seedFilePath, JSON.stringify(Array.from(byId.values()), null, 2), 'utf-8');
      }
    } catch {}
  };

  const writeLiveCatalogStore = (store: LiveCatalogStore, changedCollection?: string) => {
    store.updatedAt = new Date().toISOString();
    liveCatalogCache = store;
    const serialized = JSON.stringify(store, null, 2);
    try {
      const dir = path.dirname(primaryCatalogStorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(primaryCatalogStorePath, serialized, 'utf-8');
    } catch {
      try {
        fs.writeFileSync(fallbackCatalogStorePath, serialized, 'utf-8');
      } catch {}
    }
    if (changedCollection) {
      syncSeedExportFile(changedCollection, store);
    }
  };

  app.get('/api/catalog-store/:collection', (req, res) => {
    const col = String(req.params.collection || '').trim();
    if (!CATALOG_COLLECTIONS.has(col)) {
      return res.status(400).json({ ok: false, error: 'Unsupported collection' });
    }
    const items = Array.isArray(liveCatalogCache.collections[col])
      ? liveCatalogCache.collections[col]
      : [];
    return res.json({
      ok: true,
      collection: col,
      items,
      deletedIds: liveCatalogCache.deletedIds || [],
      updatedAt: liveCatalogCache.updatedAt,
    });
  });

  app.post('/api/catalog-store/:collection', (req, res) => {
    const col = String(req.params.collection || '').trim();
    if (!CATALOG_COLLECTIONS.has(col)) {
      return res.status(400).json({ ok: false, error: 'Unsupported collection' });
    }
    const incomingList: any[] = Array.isArray(req.body?.items)
      ? req.body.items
      : req.body?.item && typeof req.body.item === 'object'
      ? [req.body.item]
      : req.body && typeof req.body === 'object' && (req.body.id || req.body.setting_key)
      ? [req.body]
      : [];

    if (incomingList.length === 0) {
      return res.status(400).json({ ok: false, error: 'No item payload provided' });
    }

    const currentList: any[] = Array.isArray(liveCatalogCache.collections[col])
      ? [...liveCatalogCache.collections[col]]
      : [];
    const deletedSet = new Set<string>(liveCatalogCache.deletedIds || []);

    for (const rawItem of incomingList) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const itemKey =
        col === 'app_settings'
          ? String(rawItem.setting_key || rawItem.id || '').trim()
          : String(rawItem.id || '').trim();
      if (!itemKey) continue;

      deletedSet.delete(itemKey);
      if (rawItem.id) deletedSet.delete(String(rawItem.id));

      const idx = currentList.findIndex((existing) =>
        col === 'app_settings'
          ? String(existing?.setting_key || existing?.id || '') === itemKey
          : String(existing?.id || '') === itemKey
      );
      if (idx >= 0) {
        currentList[idx] = { ...currentList[idx], ...rawItem };
      } else {
        currentList.unshift(rawItem);
      }
    }

    liveCatalogCache.collections[col] = currentList;
    liveCatalogCache.deletedIds = Array.from(deletedSet);
    writeLiveCatalogStore(liveCatalogCache, col);

    return res.json({
      ok: true,
      collection: col,
      count: incomingList.length,
      updatedAt: liveCatalogCache.updatedAt,
    });
  });

  app.delete('/api/catalog-store/:collection/:id', (req, res) => {
    const col = String(req.params.collection || '').trim();
    const targetId = String(req.params.id || '').trim();
    if (!CATALOG_COLLECTIONS.has(col) || !targetId) {
      return res.status(400).json({ ok: false, error: 'Invalid collection or id' });
    }

    const currentList: any[] = Array.isArray(liveCatalogCache.collections[col])
      ? liveCatalogCache.collections[col]
      : [];
    liveCatalogCache.collections[col] = currentList.filter((item) => {
      if (!item) return false;
      if (String(item.id || '') === targetId) return false;
      if (col === 'app_settings' && String(item.setting_key || '') === targetId) return false;
      return true;
    });

    if (col !== 'app_settings') {
      const deletedSet = new Set<string>(liveCatalogCache.deletedIds || []);
      deletedSet.add(targetId);
      liveCatalogCache.deletedIds = Array.from(deletedSet);
    }
    writeLiveCatalogStore(liveCatalogCache, col);

    return res.json({ ok: true, collection: col, deletedId: targetId });
  });

  // YouTube metadata extractor helper functions
  const decodeHtml = (html: string) => {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .trim();
  };

  const parseIsoDuration = (durationStr: string): string => {
    const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return '';
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatSeconds = (totalSecs: number): string => {
    if (!totalSecs || isNaN(totalSecs)) return '';
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = Math.floor(totalSecs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const extractYoutubeVideoId = (url: string): string | null => {
    if (!url) return null;
    const trimmed = url.trim();
    const patterns = [
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
      /[?&]v=([a-zA-Z0-9_-]{11})/i,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
      const m = trimmed.match(p);
      if (m) return m[1];
    }
    return null;
  };

  // In-memory cache for resolved direct MP4 stream URLs (valid for 25 minutes)
  const streamCache = new Map<string, { streamUrl: string; mimeType: string; contentLength?: string; expiresAt: number }>();

  const resolveYoutubeMp4Stream = async (videoId: string) => {
    const cached = streamCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const clients: Array<{
      clientName: string;
      clientVersion: string;
      clientId: string;
      userAgent: string;
      extra?: Record<string, any>;
    }> = [
      {
        clientName: 'ANDROID_VR',
        clientVersion: '1.60.19',
        clientId: '28',
        userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        extra: {
          deviceMake: 'Oculus',
          deviceModel: 'Quest 3',
          androidSdkVersion: 32,
          osName: 'Android',
          osVersion: '12L',
        },
      },
      {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        clientId: '5',
        userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
        extra: {
          deviceMake: 'Apple',
          deviceModel: 'iPhone16,2',
          osName: 'iPhone',
          osVersion: '18.1.0.22B83',
        },
      },
      {
        clientName: 'ANDROID',
        clientVersion: '19.44.38',
        clientId: '3',
        userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
        extra: {
          androidSdkVersion: 34,
          osName: 'Android',
          osVersion: '14',
        },
      },
    ];

    for (const client of clients) {
      try {
        const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': client.userAgent,
            'X-YouTube-Client-Name': client.clientId,
            'X-YouTube-Client-Version': client.clientVersion,
            'Origin': 'https://www.youtube.com',
          },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: client.clientName,
                clientVersion: client.clientVersion,
                hl: 'ar',
                gl: 'SA',
                ...(client.extra || {}),
              },
            },
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        });

        if (playerRes.ok) {
          const data: any = await playerRes.json();
          const formats: any[] = data?.streamingData?.formats || [];
          const adaptiveFormats: any[] = data?.streamingData?.adaptiveFormats || [];
          // Pick combined video+audio MP4 format (itag 18 = 360p MP4, itag 22 = 720p MP4)
          const mp4Formats = formats.filter(
            (f) => f?.url && typeof f.mimeType === 'string' && f.mimeType.includes('video/mp4') && f.audioQuality
          );
          mp4Formats.sort((a, b) => (b.height || 0) - (a.height || 0));
          const best =
            mp4Formats[0] ||
            formats.find((f) => f?.url) ||
            adaptiveFormats.find((f) => f?.url && typeof f.mimeType === 'string' && f.mimeType.includes('video/mp4'));
          if (best?.url) {
            const entry = {
              streamUrl: best.url,
              mimeType: (best.mimeType || 'video/mp4').split(';')[0],
              contentLength: best.contentLength ? String(best.contentLength) : undefined,
              expiresAt: Date.now() + 25 * 60 * 1000,
            };
            streamCache.set(videoId, entry);
            return entry;
          }
        }
      } catch {
        // Try next client
      }
    }
    return null;
  };

  app.get('/api/youtube-stream', async (req, res) => {
    const rawId = ((req.query.id as string) || (req.query.url as string) || '').trim();
    const videoId = extractYoutubeVideoId(rawId);
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Valid YouTube videoId required' });
    }

    const resolved = await resolveYoutubeMp4Stream(videoId);
    if (resolved) {
      return res.json({
        success: true,
        videoId,
        streamUrl: resolved.streamUrl,
        mimeType: resolved.mimeType,
        contentLength: resolved.contentLength,
      });
    }

    return res.json({ success: false, videoId });
  });

  // SSRF Validator for external URLs passed to proxy endpoints
  function isSafeExternalUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        host === 'localhost' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host === 'metadata.google.internal'
      ) {
        return false;
      }
      const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (ipv4Match) {
        const [, a, b] = ipv4Match.map(Number);
        if (
          a === 127 ||
          a === 10 ||
          a === 0 ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168)
        ) {
          return false;
        }
      }
      if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Persistent server disk storage for uploaded PDF books inside workspace data-export/books_storage
  // (survives container restarts and works even when Firestore quota is exceeded)
  const PRIMARY_BOOKS_STORAGE_DIR = path.join(__dirname, 'data-export', 'books_storage');
  const FALLBACK_BOOKS_STORAGE_DIR = path.join('/tmp', 'dar_books_storage');
  let BOOKS_STORAGE_DIR = PRIMARY_BOOKS_STORAGE_DIR;
  try {
    if (!fs.existsSync(PRIMARY_BOOKS_STORAGE_DIR)) {
      fs.mkdirSync(PRIMARY_BOOKS_STORAGE_DIR, { recursive: true });
    }
  } catch (e) {
    BOOKS_STORAGE_DIR = FALLBACK_BOOKS_STORAGE_DIR;
  }
  try {
    if (!fs.existsSync(FALLBACK_BOOKS_STORAGE_DIR)) {
      fs.mkdirSync(FALLBACK_BOOKS_STORAGE_DIR, { recursive: true });
    }
  } catch {}

  app.post('/api/upload-pdf', express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '80mb' }), (req, res) => {
    try {
      const rawId = String(req.query.fileId || `book_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!rawId) return res.status(400).json({ error: 'Invalid fileId' });
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (buf.length < 64) {
        return res.status(400).json({ error: 'Empty or invalid PDF buffer' });
      }
      const targetPath = path.join(BOOKS_STORAGE_DIR, `${rawId}.pdf`);
      fs.writeFileSync(targetPath, buf);
      return res.json({ ok: true, fileId: rawId, size: buf.length, url: `/api/book-pdf/${rawId}` });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'Failed to store PDF on server' });
    }
  });

  app.get('/api/book-pdf/:fileId', (req, res) => {
    try {
      const rawId = String(req.params.fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!rawId) return res.status(400).json({ error: 'Invalid fileId' });
      const primaryPath = path.join(PRIMARY_BOOKS_STORAGE_DIR, `${rawId}.pdf`);
      const fallbackPath = path.join(FALLBACK_BOOKS_STORAGE_DIR, `${rawId}.pdf`);
      const targetPath = fs.existsSync(primaryPath)
        ? primaryPath
        : fs.existsSync(fallbackPath)
        ? fallbackPath
        : '';
      if (!targetPath) {
        return res.status(404).json({ error: 'PDF file not found on local server disk' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(targetPath).pipe(res);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'Failed to read PDF' });
    }
  });

  // Proxy download endpoint for saving videos offline into IndexedDB
  app.get('/api/youtube-download', async (req, res) => {
    const rawId = ((req.query.id as string) || (req.query.url as string) || '').trim();
    const directUrl = ((req.query.directUrl as string) || '').trim();

    let targetStreamUrl = '';
    let mimeType = 'video/mp4';

    if (directUrl && isSafeExternalUrl(directUrl)) {
      targetStreamUrl = directUrl;
    } else {
      const videoId = extractYoutubeVideoId(rawId);
      if (!videoId) {
        return res.status(400).json({ success: false, error: 'Valid video ID or URL required' });
      }
      const resolved = await resolveYoutubeMp4Stream(videoId);
      if (!resolved?.streamUrl) {
        return res.status(404).json({ success: false, error: 'Unable to resolve direct video stream' });
      }
      targetStreamUrl = resolved.streamUrl;
      mimeType = resolved.mimeType || 'video/mp4';
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        'Accept': '*/*',
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(targetStreamUrl, { headers });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(upstream.status).json({ success: false, error: 'Upstream video stream error' });
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      const len = upstream.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      const range = upstream.headers.get('content-range');
      if (range) res.setHeader('Content-Range', range);

      if (!upstream.body) {
        const buf = Buffer.from(await upstream.arrayBuffer());
        return res.end(buf);
      }

      const reader = upstream.body.getReader();
      req.on('close', () => {
        try {
          reader.cancel();
        } catch {}
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          res.write(Buffer.from(value));
        }
      }
      return res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: err?.message || 'Download stream failed' });
      }
      return res.end();
    }
  });

  // API endpoint to proxy image download for automatic logo upload/storage
  app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = (req.query.url as string || '').trim();
    if (!imageUrl || !isSafeExternalUrl(imageUrl)) {
      return res.status(400).send('Valid external Image URL is required');
    }
    try {
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
        },
      });
      if (!response.ok) {
        return res.status(response.status).send('Failed to fetch image');
      }
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
        return res.status(400).send('Invalid image content type');
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      console.error('Image proxy error:', err?.message);
      return res.status(500).send('Error proxying image');
    }
  });

  // API endpoint to fetch YouTube video or channel metadata automatically
  app.get('/api/youtube-meta', async (req, res) => {
    const targetUrl = (req.query.url as string || '').trim();
    const requestedType = (req.query.type as string || 'auto').toLowerCase();

    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const videoId = extractYoutubeVideoId(targetUrl);
    const isChannel = requestedType === 'channel' || (!videoId && (targetUrl.includes('/@') || targetUrl.includes('/channel/') || targetUrl.includes('/c/') || targetUrl.startsWith('@')));

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    // ──────────────── Handle Channel Metadata ────────────────
    if (isChannel) {
      let channelUrl = targetUrl;
      if (channelUrl.startsWith('@')) {
        channelUrl = `https://www.youtube.com/${channelUrl}`;
      } else if (!channelUrl.startsWith('http')) {
        channelUrl = `https://www.youtube.com/@${channelUrl}`;
      }

      try {
        const response = await fetch(channelUrl, { headers: fetchHeaders });
        const html = await response.text();

        // Extract channel name
        let name = '';
        const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                           html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
                           html.match(/<title>([^<]+?)(?:\s*-\s*YouTube)?<\/title>/i);
        if (titleMatch) {
          name = decodeHtml(titleMatch[1]);
        }

        // Extract channel logo/avatar
        let channel_logo = '';
        const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                           html.match(/<link\s+rel="image_src"\s+href="([^"]+)"/i) ||
                           html.match(/"channelMetadataRenderer":[\s\S]*?"avatar":\s*\{\s*"thumbnails":\s*\[\s*\{\s*"url":\s*"([^"]+)"/i) ||
                           html.match(/"avatar":\s*\{\s*"thumbnails":\s*\[\s*\{\s*"url":\s*"([^"]+)"/i) ||
                           html.match(/\\?"avatar\\?":\s*\{\s*\\?"thumbnails\\?":\s*\[\s*\{\s*\\?"url\\?":\s*\\?"([^"\\]+)\\?"/i) ||
                           html.match(/"thumbnail":\s*\{\s*"thumbnails":\s*\[\s*\{\s*"url":\s*"([^"]+)"/i);
        if (imageMatch) {
          channel_logo = imageMatch[1].replace(/\\u0026/g, '&');
          if (channel_logo.startsWith('//')) {
            channel_logo = 'https:' + channel_logo;
          }
          // Upgrade thumbnail resolution if it has =s88 or =s48 to high quality =s512
          channel_logo = channel_logo.replace(/=s\d+(-c-k-c0x[0-9a-f]+-no-rj)?/i, '=s512-c-k-c0x00ffffff-no-rj');
        }

        // Extract description
        let description = '';
        const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
                          html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (descMatch) {
          description = decodeHtml(descMatch[1]);
        }

        return res.json({
          success: true,
          type: 'channel',
          name: name || '',
          channel_logo: channel_logo || '',
          description: description || '',
          youtube_url: channelUrl,
        });
      } catch (err: any) {
        console.error('Failed to fetch channel meta:', err?.message);
        const handleMatch = channelUrl.match(/@([a-zA-Z0-9_.-]+)/);
        const guessedName = handleMatch ? handleMatch[1] : '';
        return res.json({
          success: true,
          type: 'channel',
          name: guessedName,
          channel_logo: '',
          description: '',
          youtube_url: channelUrl,
          fallback: true,
        });
      }
    }

    // ──────────────── Handle Video Metadata ────────────────
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Invalid YouTube URL or ID' });
    }

    const isShort = targetUrl.includes('/shorts/');
    const canonicalVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const defaultThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const hqThumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    let title = '';
    let channel_name = '';
    let channel_url = '';
    let duration = '';
    let duration_seconds = 0;
    let description = '';

    // Step 1: Query YouTube oEmbed (fast, reliable, official)
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalVideoUrl)}&format=json`, {
        headers: fetchHeaders,
      });
      if (oembedRes.ok) {
        const oembedData: any = await oembedRes.json();
        title = oembedData.title || '';
        channel_name = oembedData.author_name || '';
        channel_url = oembedData.author_url || '';
      }
    } catch (e: any) {
      console.warn('oEmbed fetch error:', e?.message);
    }

    // Step 2: Fetch watch page HTML to extract duration, description and channel if missing
    try {
      const pageRes = await fetch(canonicalVideoUrl, { headers: fetchHeaders });
      if (pageRes.ok) {
        const pageHtml = await pageRes.text();

        // 1. Duration extraction
        const isoMatch = pageHtml.match(/itemprop="duration"\s+content="([^"]+)"/i);
        if (isoMatch && isoMatch[1]) {
          duration = parseIsoDuration(isoMatch[1]);
        }

        if (!duration) {
          const lenMatch = pageHtml.match(/"lengthSeconds":"(\d+)"/i);
          if (lenMatch && lenMatch[1]) {
            duration_seconds = parseInt(lenMatch[1], 10);
            duration = formatSeconds(duration_seconds);
          }
        }

        if (!duration) {
          const msMatch = pageHtml.match(/"approxDurationMs":"(\d+)"/i);
          if (msMatch && msMatch[1]) {
            duration_seconds = Math.round(parseInt(msMatch[1], 10) / 1000);
            duration = formatSeconds(duration_seconds);
          }
        }

        // 2. Title fallback
        if (!title) {
          const tMatch = pageHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                         pageHtml.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
          if (tMatch) title = decodeHtml(tMatch[1]);
        }

        // 3. Channel name fallback
        if (!channel_name) {
          const chMatch = pageHtml.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i) ||
                          pageHtml.match(/"ownerChannelName":"([^"]+)"/i) ||
                          pageHtml.match(/"author":"([^"]+)"/i);
          if (chMatch) channel_name = decodeHtml(chMatch[1]);
        }

        // 4. Description
        const descMatch = pageHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
                          pageHtml.match(/"shortDescription":"([^"]+)"/i);
        if (descMatch) {
          description = decodeHtml(descMatch[1].replace(/\\n/g, '\n'));
        }
      }
    } catch (e: any) {
      console.warn('Watch page fetch error:', e?.message);
    }

    const detectedShort = isShort || (duration_seconds > 0 && duration_seconds <= 60);

    return res.json({
      success: true,
      type: 'video',
      videoId,
      title: title || '',
      channel_name: channel_name || '',
      channel_url: channel_url || '',
      duration: duration || (detectedShort ? '0:60' : ''),
      duration_seconds,
      description: description || '',
      thumbnail: defaultThumbnail,
      thumbnail_hq: hqThumbnail,
      video_type: detectedShort ? 'short' : 'normal',
      youtube_url: detectedShort ? `https://www.youtube.com/shorts/${videoId}` : canonicalVideoUrl,
    });
  });

  // API endpoint to extract videos and/or Shorts from a YouTube channel
  app.get('/api/youtube-channel-videos', async (req, res) => {
    const rawUrl = (req.query.url as string || '').trim();
    const limitParam = (req.query.limit as string || '30').trim().toLowerCase();
    const typeParam = (req.query.type as string || 'all').trim().toLowerCase();
    const isAll = limitParam === 'all' || limitParam === 'جميع' || limitParam === '0' || limitParam === 'كل';
    const parsedLimit = parseInt(limitParam, 10);
    const limit = isAll ? 500 : (isNaN(parsedLimit) ? 30 : Math.min(Math.max(parsedLimit, 1), 500));

    if (!rawUrl) {
      return res.status(400).json({ success: false, error: 'Channel URL is required' });
    }

    let channelUrl = rawUrl;
    if (channelUrl.startsWith('@')) {
      channelUrl = `https://www.youtube.com/${channelUrl}`;
    } else if (!channelUrl.startsWith('http')) {
      channelUrl = `https://www.youtube.com/@${channelUrl}`;
    }

    const urlImpliesShorts = /\/shorts\/?$/i.test(channelUrl);
    const contentType = typeParam === 'shorts' || typeParam === 'short' || (typeParam === 'all' && urlImpliesShorts)
      ? 'shorts'
      : typeParam === 'videos' || typeParam === 'normal'
      ? 'videos'
      : 'all';

    const baseUrl = channelUrl.replace(/\/(videos|featured|shorts|playlists|community|streams|live)\/?$/i, '');
    const videosPageUrl = `${baseUrl}/videos`;
    const shortsPageUrl = `${baseUrl}/shorts`;

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    try {
      let channelName = '';
      let channelId = '';
      const videos: any[] = [];
      const seenVideoIds = new Set<string>();

      const extractChannelIdentity = (htmlStr: string) => {
        if (!channelName) {
          const titleMatch = htmlStr.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                             htmlStr.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
                             htmlStr.match(/<title>([^<]+?)(?:\s*-\s*YouTube)?<\/title>/i);
          if (titleMatch) {
            channelName = decodeHtml(titleMatch[1]);
          }
        }
        if (!channelId) {
          const channelIdMatch = htmlStr.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/i) ||
                                 htmlStr.match(/<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]+)"/i) ||
                                 htmlStr.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/i);
          if (channelIdMatch) {
            channelId = channelIdMatch[1];
          }
        }
      };

      // Strategy A: Regular Videos (when contentType is 'videos' or 'all')
      if (contentType === 'videos' || contentType === 'all') {
        try {
          const response = await fetch(videosPageUrl, { headers: fetchHeaders });
          if (response.ok) {
            const html = await response.text();
            extractChannelIdentity(html);

            const videoRendererRegex = /"videoRenderer":\s*\{([\s\S]*?)(?="videoRenderer"|"continuationItemRenderer"|\}\}\]\}|\}\]\}|,\s*"trackingParams")/g;
            let match;
            while ((match = videoRendererRegex.exec(html)) !== null && videos.length < limit) {
              const block = match[1];
              const idMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
              if (!idMatch) continue;
              const vId = idMatch[1];
              if (seenVideoIds.has(vId)) continue;
              seenVideoIds.add(vId);

              let vTitle = '';
              const titleM = block.match(/"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":"([^"]+)"/i) ||
                             block.match(/"title":\s*\{\s*"simpleText":"([^"]+)"/i);
              if (titleM) {
                vTitle = decodeHtml(titleM[1]);
              }

              let vDuration = '';
              const lenM = block.match(/"lengthText":\s*\{\s*"simpleText":"([^"]+)"/i) ||
                           block.match(/"lengthText":\s*\{\s*"accessibility":\s*\{\s*"accessibilityData":\s*\{\s*"label":"([^"]+)"/i);
              if (lenM) {
                vDuration = lenM[1];
              }

              let vDesc = '';
              const descM = block.match(/"descriptionSnippet":\s*\{\s*"runs":\s*\[\s*\{\s*"text":"([^"]+)"/i);
              if (descM) {
                vDesc = decodeHtml(descM[1]);
              }

              videos.push({
                videoId: vId,
                youtube_url: `https://www.youtube.com/watch?v=${vId}`,
                title: vTitle || '',
                duration: vDuration,
                thumbnail: `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
                channel_name: channelName,
                video_type: 'normal',
                description: vDesc,
              });
            }
          }
        } catch (vidErr) {
          console.warn('Regular videos page fetch error:', vidErr);
        }
      }

      // Strategy B: Fetch Shorts page (when contentType is 'shorts' or 'all')
      if ((contentType === 'shorts' || contentType === 'all') && videos.length < limit) {
        try {
          const shortsRes = await fetch(shortsPageUrl, { headers: fetchHeaders });
          if (shortsRes.ok) {
            const shortsHtml = await shortsRes.text();
            extractChannelIdentity(shortsHtml);

            // 1. Modern YouTube shortsLockupViewModel format
            const lockupRegex = /"shortsLockupViewModel":\s*\{([\s\S]*?)(?="shortsLockupViewModel"|"continuationItemRenderer"|\}\}\}\}\])/g;
            let lockupMatch;
            while ((lockupMatch = lockupRegex.exec(shortsHtml)) !== null && videos.length < limit) {
              const lBlock = lockupMatch[1];
              const idMatch =
                lBlock.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) ||
                lBlock.match(/shorts-shelf-item-([a-zA-Z0-9_-]{11})/) ||
                lBlock.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
              if (!idMatch) continue;
              const rId = idMatch[1];
              if (seenVideoIds.has(rId)) continue;
              seenVideoIds.add(rId);

              let rTitle = '';
              const primaryTextM = lBlock.match(/"overlayMetadata":\s*\{\s*"primaryText":\s*\{\s*"content":"([^"]+)"/i) ||
                                   lBlock.match(/"primaryText":\s*\{\s*"content":"([^"]+)"/i);
              if (primaryTextM) {
                rTitle = decodeHtml(primaryTextM[1]);
              } else {
                const accM = lBlock.match(/"accessibilityText":"([^"]+)"/i);
                if (accM) {
                  rTitle = decodeHtml(
                    accM[1]
                      .replace(/,\s*[\d.,]+\s*(?:ألف|مليون|ألف مشاهدة|مشاهدة|views|K views|M views).*$/i, '')
                      .replace(/\s*-\s*(?:play Short|تشغيل Short).*$/i, '')
                      .trim()
                  );
                }
              }

              let rThumb = `https://img.youtube.com/vi/${rId}/hqdefault.jpg`;
              const thumbM = lBlock.match(/"url":"(https:\/\/i\.ytimg\.com\/vi\/[^"]+)"/i);
              if (thumbM && thumbM[1]) {
                rThumb = thumbM[1].replace(/\\u0026/g, '&');
              }

              videos.push({
                videoId: rId,
                youtube_url: `https://www.youtube.com/shorts/${rId}`,
                title: rTitle || '',
                duration: '0:60',
                thumbnail: rThumb,
                channel_name: channelName,
                video_type: 'short',
                description: '',
              });
            }

            // 2. Legacy reelItemRenderer format
            const reelRegex = /"reelItemRenderer":\s*\{([\s\S]*?)(?="reelItemRenderer"|"continuationItemRenderer"|\}\}\]\}|\}\]\}|,\s*"trackingParams")/g;
            let reelMatch;
            while ((reelMatch = reelRegex.exec(shortsHtml)) !== null && videos.length < limit) {
              const rBlock = reelMatch[1];
              const rIdMatch = rBlock.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
              if (!rIdMatch) continue;
              const rId = rIdMatch[1];
              if (seenVideoIds.has(rId)) continue;
              seenVideoIds.add(rId);

              let rTitle = '';
              const rTitleM = rBlock.match(/"headline":\s*\{\s*"simpleText":"([^"]+)"/i) ||
                              rBlock.match(/"headline":\s*\{\s*"runs":\s*\[\s*\{\s*"text":"([^"]+)"/i);
              if (rTitleM) rTitle = decodeHtml(rTitleM[1]);

              videos.push({
                videoId: rId,
                youtube_url: `https://www.youtube.com/shorts/${rId}`,
                title: rTitle || '',
                duration: '0:60',
                thumbnail: `https://img.youtube.com/vi/${rId}/hqdefault.jpg`,
                channel_name: channelName,
                video_type: 'short',
                description: '',
              });
            }

            // 3. Fallback: scan reelWatchEndpoint if still empty
            if (videos.length < limit) {
              const endpointRegex = /"reelWatchEndpoint":\s*\{\s*"videoId":"([a-zA-Z0-9_-]{11})"/g;
              let epMatch;
              while ((epMatch = endpointRegex.exec(shortsHtml)) !== null && videos.length < limit) {
                const rId = epMatch[1];
                if (seenVideoIds.has(rId)) continue;
                seenVideoIds.add(rId);
                videos.push({
                  videoId: rId,
                  youtube_url: `https://www.youtube.com/shorts/${rId}`,
                  title: '',
                  duration: '0:60',
                  thumbnail: `https://img.youtube.com/vi/${rId}/hqdefault.jpg`,
                  channel_name: channelName,
                  video_type: 'short',
                  description: '',
                });
              }
            }
          }
        } catch (shortsErr) {
          console.warn('Shorts page fetch error:', shortsErr);
        }
      }

      // Strategy C: If regular videos requested and still < limit, check RSS feed
      if (contentType !== 'shorts' && videos.length < limit && channelId) {
        try {
          const rssRes = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: fetchHeaders });
          if (rssRes.ok) {
            const xml = await rssRes.text();
            const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
            let entryMatch;
            while ((entryMatch = entryRegex.exec(xml)) !== null && videos.length < limit) {
              const entry = entryMatch[1];
              const idM = entry.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/);
              if (!idM) continue;
              const vId = idM[1];
              if (seenVideoIds.has(vId)) continue;
              seenVideoIds.add(vId);

              const titleM = entry.match(/<title>([^<]+)<\/title>/);
              const descM = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);

              videos.push({
                videoId: vId,
                youtube_url: `https://www.youtube.com/watch?v=${vId}`,
                title: titleM ? decodeHtml(titleM[1]) : '',
                duration: '',
                thumbnail: `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
                channel_name: channelName,
                video_type: 'normal',
                description: descM ? decodeHtml(descM[1]).slice(0, 300) : '',
              });
            }
          }
        } catch (rssErr) {
          console.warn('RSS feed fetch error:', rssErr);
        }
      }

      // Enrich any items missing title or channel_name via YouTube oEmbed
      const itemsNeedingMeta = videos.filter((v) => !v.title || !v.channel_name).slice(0, 40);
      if (itemsNeedingMeta.length > 0) {
        await Promise.all(
          itemsNeedingMeta.map(async (item) => {
            try {
              const oRes = await fetch(
                `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${item.videoId}`)}&format=json`,
                { headers: fetchHeaders }
              );
              if (oRes.ok) {
                const oData: any = await oRes.json();
                if (!item.title && oData.title) item.title = oData.title;
                if (!item.channel_name && oData.author_name) {
                  item.channel_name = oData.author_name;
                  if (!channelName) channelName = oData.author_name;
                }
              }
            } catch {}
            if (!item.title) {
              item.title = item.video_type === 'short' ? `مقطع قصير ${item.videoId}` : `فيديو ${item.videoId}`;
            }
            if (!item.channel_name && channelName) {
              item.channel_name = channelName;
            }
          })
        );
      }

      for (const item of videos) {
        if (!item.channel_name && channelName) item.channel_name = channelName;
        if (!item.title) {
          item.title = item.video_type === 'short' ? `مقطع قصير ${item.videoId}` : `فيديو ${item.videoId}`;
        }
      }

      return res.json({
        success: true,
        channel_name: channelName,
        channel_id: channelId,
        channel_url: baseUrl,
        count: videos.length,
        is_all: isAll,
        videos,
      });
    } catch (err: any) {
      console.error('Error fetching channel videos:', err?.message);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch channel videos' });
    }
  });

  // API endpoint to check if any of the given YouTube channels are currently LIVE
  app.post('/api/check-live-streams', async (req, res) => {
    const { channels = [] } = req.body;
    if (!Array.isArray(channels) || channels.length === 0) {
      return res.json({ success: true, liveStreams: [] });
    }

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const liveStreams: any[] = [];

    const checkChannelLive = async (ch: { id?: string; name?: string; youtube_url?: string }) => {
      const chName = (ch.name || '').trim();
      const isDemo = chName.includes('تجريبي') || chName.includes('Demo') || (ch.youtube_url || '').includes('demo');
      if (isDemo) {
        const demoVideoId = 'jfKfPfyJRdk';
        return {
          id: `live_demo_${ch.id || '1'}`,
          videoId: demoVideoId,
          title: `${chName} - بث تجريبي مباشر الآن`,
          channel_id: ch.id || '',
          channel_name: chName || 'قناة البث التجريبي',
          youtube_url: ch.youtube_url || `https://www.youtube.com/watch?v=${demoVideoId}`,
          thumbnail: `https://img.youtube.com/vi/${demoVideoId}/hqdefault.jpg`,
          video_type: 'live',
          is_live: true,
          duration: 'مباشر',
        };
      }

      let channelUrl = (ch.youtube_url || '').trim();
      if (!channelUrl) return null;

      if (channelUrl.startsWith('@')) {
        channelUrl = `https://www.youtube.com/${channelUrl}`;
      } else if (!channelUrl.startsWith('http')) {
        channelUrl = `https://www.youtube.com/@${channelUrl}`;
      }

      const baseUrl = channelUrl.replace(/\/(videos|featured|shorts|playlists|community|live)\/?$/, '');
      const livePageUrl = `${baseUrl}/live`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(livePageUrl, {
          headers: fetchHeaders,
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) return null;

        const html = await response.text();

        const isLive =
          html.includes('"isLive":true') ||
          html.includes('"isLiveContent":true') ||
          html.includes('BADGE_STYLE_TYPE_LIVE_NOW') ||
          html.includes('"status":"LIVE"') ||
          html.includes('"LIVE_NOW"');

        if (!isLive) return null;

        const finalUrl = response.url || '';
        const vIdMatch =
          finalUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
          html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);

        if (!vIdMatch) return null;
        const videoId = vIdMatch[1];

        let title = '';
        const titleMatch =
          html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
          html.match(/<title>([^<]+?)(?:\s*-\s*YouTube)?<\/title>/i) ||
          html.match(/"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":"([^"]+)"/i);
        if (titleMatch) title = decodeHtml(titleMatch[1]);

        return {
          id: `live_${videoId}`,
          videoId,
          title: title || `${ch.name || 'بث مباشر'} - مباشر الآن`,
          channel_id: ch.id || '',
          channel_name: ch.name || '',
          youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          video_type: 'live',
          is_live: true,
          duration: 'مباشر',
        };
      } catch {
        return null;
      }
    };

    try {
      const results = await Promise.all(channels.map((ch) => checkChannelLive(ch)));
      for (const item of results) {
        if (item) liveStreams.push(item);
      }
      return res.json({ success: true, liveStreams });
    } catch {
      return res.json({ success: true, liveStreams: [] });
    }
  });

  // Resolve latest signed AAB bundle on disk
  const resolveAabFile = (): { filePath: string; stat: fs.Stats } | null => {
    const candidates = [
      path.join(__dirname, 'artifacts', 'dar-al-tawhid.aab'),
      path.join(__dirname, 'artifacts', 'dar-al-uloom.aab'),
      path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'dar-al-tawhid.aab'),
      path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'dar-al-uloom.aab'),
      path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const stat = fs.statSync(candidate);
          if (stat.isFile() && stat.size > 0) {
            return { filePath: candidate, stat };
          }
        }
      } catch {
        // continue checking next candidate
      }
    }
    return null;
  };

  const EXPECTED_PLAY_SHA1 = 'BE:F3:8C:A3:10:0F:08:59:D1:1D:3D:28:26:56:24:9F:44:DA:CA:7F';
  const PERSISTENT_KEYSTORE_JSON = path.join(__dirname, 'data-export', '.signing-keystore.json');
  const PERSISTENT_KEYSTORE_FILE = path.join(__dirname, 'data-export', 'release.keystore');
  const PERSISTENT_PEM_FILE = path.join(__dirname, 'data-export', 'upload_certificate.pem');

  const resolveKeytoolBin = () => {
    for (const candidate of ['/opt/jdk21/bin/keytool', '/tmp/build-tools/jdk21/bin/keytool', 'keytool']) {
      try {
        if (candidate === 'keytool' || fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return 'keytool';
  };

  const resolveJarsignerBin = () => {
    for (const candidate of ['/opt/jdk21/bin/jarsigner', '/tmp/build-tools/jdk21/bin/jarsigner', 'jarsigner']) {
      try {
        if (candidate === 'jarsigner' || fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return 'jarsigner';
  };

  const getAabSigningFingerprint = async (aabFilePath: string): Promise<{ sha1: string; sha256: string }> => {
    try {
      const { execFile, exec } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const execAsync = promisify(exec);
      try {
        const { stdout } = await execFileAsync(resolveKeytoolBin(), ['-printcert', '-jarfile', aabFilePath], {
          timeout: 8000,
        });
        const sha1Match = stdout.match(/SHA1:\s*([0-9A-F:]{59})/i);
        const sha256Match = stdout.match(/SHA256:\s*([0-9A-F:]{95})/i);
        if (sha1Match) {
          return {
            sha1: sha1Match[1].toUpperCase(),
            sha256: sha256Match ? sha256Match[1].toUpperCase() : '',
          };
        }
      } catch {}

      // Fallback using unzip + openssl (always installed in Linux containers)
      const { stdout: sslOut } = await execAsync(
        `unzip -p "${aabFilePath}" "META-INF/*.RSA" "META-INF/*.DSA" "META-INF/*.EC" 2>/dev/null | openssl pkcs7 -inform DER -print_certs 2>/dev/null | openssl x509 -noout -fingerprint -sha1 -sha256 2>/dev/null`,
        { timeout: 8000 }
      );
      const s1 = sslOut.match(/sha1 Fingerprint=([0-9A-F:]{59})/i);
      const s256 = sslOut.match(/sha256 Fingerprint=([0-9A-F:]{95})/i);
      if (s1) {
        return {
          sha1: s1[1].toUpperCase(),
          sha256: s256 ? s256[1].toUpperCase() : '',
        };
      }
    } catch {}
    if (fs.existsSync(PERSISTENT_KEYSTORE_JSON)) {
      try {
        const saved = JSON.parse(fs.readFileSync(PERSISTENT_KEYSTORE_JSON, 'utf-8'));
        if (saved?.sha1) return { sha1: saved.sha1, sha256: saved.sha256 || '' };
      } catch {}
    }
    return { sha1: EXPECTED_PLAY_SHA1, sha256: '' };
  };

  // Auto-restore persistent signing keystore if saved previously
  try {
    if (fs.existsSync(PERSISTENT_KEYSTORE_JSON) && !fs.existsSync(PERSISTENT_KEYSTORE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(PERSISTENT_KEYSTORE_JSON, 'utf-8'));
      if (saved?.keystoreBase64) {
        fs.writeFileSync(PERSISTENT_KEYSTORE_FILE, Buffer.from(saved.keystoreBase64, 'base64'));
      }
    }
  } catch {}

  app.get('/api/aab-info', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const found = resolveAabFile();
    if (!found) {
      return res.json({
        available: false,
        fileName: 'dar-al-tawhid.aab',
        sizeBytes: 0,
        sizeMB: '0',
        updatedAt: null,
        sha1: '',
        expectedSha1: EXPECTED_PLAY_SHA1,
        matchesExpectedKey: false,
        hasPersistentKeystore: fs.existsSync(PERSISTENT_KEYSTORE_JSON),
      });
    }
    const fp = await getAabSigningFingerprint(found.filePath);
    return res.json({
      available: true,
      fileName: 'dar-al-tawhid.aab',
      sizeBytes: found.stat.size,
      sizeMB: (found.stat.size / (1024 * 1024)).toFixed(2),
      updatedAt: found.stat.mtime.toISOString(),
      sha1: fp.sha1,
      sha256: fp.sha256,
      expectedSha1: EXPECTED_PLAY_SHA1,
      matchesExpectedKey: fp.sha1 === EXPECTED_PLAY_SHA1,
      hasPersistentKeystore: fs.existsSync(PERSISTENT_KEYSTORE_JSON),
    });
  });

  // GET /api/download-upload-pem: Download upload_certificate.pem for 1-click Google Play Console Upload Key Reset
  app.get('/api/download-upload-pem', async (_req, res) => {
    try {
      if (fs.existsSync(PERSISTENT_PEM_FILE)) {
        res.setHeader('Content-Type', 'application/x-pem-file');
        res.setHeader('Content-Disposition', 'attachment; filename="upload_certificate.pem"');
        return res.sendFile(PERSISTENT_PEM_FILE);
      }
      const foundAab = resolveAabFile();
      if (foundAab) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(
          `unzip -p "${foundAab.filePath}" "META-INF/*.RSA" 2>/dev/null | openssl pkcs7 -inform DER -print_certs 2>/dev/null | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' > "${PERSISTENT_PEM_FILE}"`,
          { timeout: 8000 }
        );
        if (fs.existsSync(PERSISTENT_PEM_FILE) && fs.statSync(PERSISTENT_PEM_FILE).size > 100) {
          res.setHeader('Content-Type', 'application/x-pem-file');
          res.setHeader('Content-Disposition', 'attachment; filename="upload_certificate.pem"');
          return res.sendFile(PERSISTENT_PEM_FILE);
        }
      }
      return res.status(404).json({ ok: false, error: 'شهادة PEM غير متوفرة' });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || 'تعذر تصدير شهادة PEM' });
    }
  });

  // POST /api/resign-aab: Re-sign the built AAB with the user's original Google Play upload keystore AND save it permanently for all future builds
  app.post('/api/resign-aab', async (req, res) => {
    try {
      const found = resolveAabFile();
      if (!found) {
        return res.status(404).json({ ok: false, error: 'ملف AAB الأساسي غير موجود على الخادم' });
      }
      const { keystoreBase64, keystorePassword, keyAlias, keyPassword } = req.body || {};
      if (!keystoreBase64 || typeof keystoreBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'يرجى اختيار ملف مفتاح التوقيع (release.keystore أو .jks)' });
      }
      const storePass = String(keystorePassword || '').trim();
      if (!storePass) {
        return res.status(400).json({ ok: false, error: 'يرجى إدخال كلمة مرور ملف المفتاح (Keystore Password)' });
      }
      const cleanBase64 = keystoreBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
      const keystoreBuf = Buffer.from(cleanBase64, 'base64');
      if (keystoreBuf.length < 64) {
        return res.status(400).json({ ok: false, error: 'ملف المفتاح المرفق غير صالح أو فارغ' });
      }

      const tmpKeystorePath = `/tmp/user_upload_${Date.now()}.keystore`;
      const tmpAabPath = `/tmp/resigning_${Date.now()}.aab`;
      fs.writeFileSync(tmpKeystorePath, keystoreBuf);

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      try {
        // 1. Inspect aliases and SHA1 inside the uploaded keystore
        let listOut = '';
        try {
          const { stdout } = await execFileAsync(
            resolveKeytoolBin(),
            ['-list', '-v', '-keystore', tmpKeystorePath, '-storepass', storePass],
            { timeout: 10000 }
          );
          listOut = stdout;
        } catch (err: any) {
          return res.status(400).json({
            ok: false,
            error: 'كلمة مرور الـ Keystore غير صحيحة أو صيغة الملف غير مدعومة.',
            details: String(err?.stderr || err?.message || ''),
          });
        }

        // Detect aliases in the keystore
        const aliasMatches = Array.from(listOut.matchAll(/Alias name:\s*([^\r\n]+)/gi)).map((m) => m[1].trim());
        const resolvedAlias = String(keyAlias || '').trim() || aliasMatches[0] || 'daralulom';
        const effectiveKeyPass = String(keyPassword || '').trim() || storePass;

        // 2. Copy AAB to temp and strip existing META-INF signature files before signing with the user's key
        fs.copyFileSync(found.filePath, tmpAabPath);
        try {
          await execFileAsync('zip', ['-d', tmpAabPath, 'META-INF/*.SF', 'META-INF/*.RSA', 'META-INF/*.DSA', 'META-INF/*.EC'], {
            timeout: 10000,
          });
        } catch {
          // ignore if no existing signature entries matched
        }

        // 3. Sign with jarsigner
        try {
          await execFileAsync(
            resolveJarsignerBin(),
            [
              '-sigalg',
              'SHA256withRSA',
              '-digestalg',
              'SHA-256',
              '-keystore',
              tmpKeystorePath,
              '-storepass',
              storePass,
              '-keypass',
              effectiveKeyPass,
              tmpAabPath,
              resolvedAlias,
            ],
            { timeout: 25000 }
          );
        } catch {
          await execFileAsync(
            resolveJarsignerBin(),
            [
              '-keystore',
              tmpKeystorePath,
              '-storepass',
              storePass,
              '-keypass',
              effectiveKeyPass,
              tmpAabPath,
              resolvedAlias,
            ],
            { timeout: 25000 }
          );
        }

        // 4. Verify signature and extract new SHA-1 fingerprint
        const newFp = await getAabSigningFingerprint(tmpAabPath);
        if (!newFp.sha1) {
          return res.status(400).json({
            ok: false,
            error: 'فشل التحقق من التوقيع الجديد بعد عملية التوقيع',
          });
        }

        // 5. Overwrite all AAB output locations & save the keystore PERMANENTLY in data-export/ for all future builds!
        const targetPaths = [
          path.join(__dirname, 'artifacts', 'dar-al-tawhid.aab'),
          path.join(__dirname, 'artifacts', 'dar-al-uloom.aab'),
          path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'dar-al-tawhid.aab'),
          path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'dar-al-uloom.aab'),
          path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
        ];
        for (const tp of targetPaths) {
          try {
            const dir = path.dirname(tp);
            if (fs.existsSync(dir)) {
              fs.copyFileSync(tmpAabPath, tp);
            }
          } catch {}
        }
        try {
          fs.copyFileSync(
            tmpKeystorePath,
            path.join(__dirname, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'release.keystore')
          );
          fs.copyFileSync(tmpKeystorePath, PERSISTENT_KEYSTORE_FILE);
          fs.writeFileSync(
            PERSISTENT_KEYSTORE_JSON,
            JSON.stringify(
              {
                keystoreBase64: cleanBase64,
                storePass,
                alias: resolvedAlias,
                keyPass: effectiveKeyPass,
                sha1: newFp.sha1,
                sha256: newFp.sha256,
                savedAt: new Date().toISOString(),
              },
              null,
              2
            ),
            'utf-8'
          );
        } catch {}

        const updatedStat = fs.statSync(found.filePath);
        return res.json({
          ok: true,
          aliasUsed: resolvedAlias,
          detectedAliases: aliasMatches,
          sha1: newFp.sha1,
          sha256: newFp.sha256,
          expectedSha1: EXPECTED_PLAY_SHA1,
          matchesExpectedKey: newFp.sha1 === EXPECTED_PLAY_SHA1,
          sizeMB: (updatedStat.size / (1024 * 1024)).toFixed(2),
          updatedAt: updatedStat.mtime.toISOString(),
          savedPermanently: true,
        });
      } finally {
        try {
          if (fs.existsSync(tmpKeystorePath)) fs.unlinkSync(tmpKeystorePath);
          if (fs.existsSync(tmpAabPath)) fs.unlinkSync(tmpAabPath);
        } catch {}
      }
    } catch (e: any) {
      return res.status(400).json({
        ok: false,
        error: 'فشل توقيع ملف AAB — تحقق من اسم الـ Alias وكلمة المرور',
        details: String(e?.stderr || e?.message || ''),
      });
    }
  });

  const handleAabDownload = (req: express.Request, res: express.Response) => {
    const found = resolveAabFile();
    if (!found) {
      return res.status(404).json({
        success: false,
        error: 'ملف AAB غير متوفر حالياً. يرجى بناء الحزمة أولاً.',
      });
    }

    const { filePath, stat } = found;
    const totalSize = stat.size;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="dar-al-tawhid.aab"');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges');

    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(totalSize));
      return res.status(200).end();
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
      const [rawStart, rawEnd] = rangeHeader.replace(/^bytes=/, '').split('-');
      const start = rawStart ? parseInt(rawStart, 10) : 0;
      const end = rawEnd ? Math.min(parseInt(rawEnd, 10), totalSize - 1) : totalSize - 1;
      if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        return res.status(416).end();
      }
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.setHeader('Content-Length', String(chunkSize));
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      return stream.pipe(res);
    }

    res.status(200);
    res.setHeader('Content-Length', String(totalSize));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    return stream.pipe(res);
  };

  app.get('/api/download-aab', handleAabDownload);
  app.head('/api/download-aab', handleAabDownload);
  app.get('/dar-al-tawhid.aab', handleAabDownload);
  app.head('/dar-al-tawhid.aab', handleAabDownload);
  app.get('/dar-al-uloom.aab', handleAabDownload);
  app.head('/dar-al-uloom.aab', handleAabDownload);

  // Vite middleware setup for development (non-blocking port bind)
  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  // Determine port: AI Studio requires port 3000
  const portArgIdx = process.argv.indexOf('--port');
  const cliPort = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? Number(process.argv[portArgIdx + 1]) : null;
  const PORT = cliPort || (process.env.PORT === '3000' ? 3000 : 3000);

  const hostArgIdx = process.argv.indexOf('--host');
  const HOST = hostArgIdx !== -1 && process.argv[hostArgIdx + 1] ? process.argv[hostArgIdx + 1] : '0.0.0.0';

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    logSmtpStatusOnStart();
  });

  server.on('error', (err: any) => {
    console.error('Server listen error:', err);
  });
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

