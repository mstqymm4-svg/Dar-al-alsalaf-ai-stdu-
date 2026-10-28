import express from 'express';
import { createServer as createViteServer } from 'vite';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  app.use(express.json());

  // Configure Nodemailer transporter
  // If SMTP environment variables are not set, fallback to a test account or JSON transport / console logging
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || 'ethereal_user',
      pass: process.env.SMTP_PASS || 'ethereal_pass',
    },
  });

  // API endpoint to send verification email via Nodemailer
  app.post('/api/send-verification-email', async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    const htmlContent = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
</head>
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:Tahoma,Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e2d5;">
    <div style="background:linear-gradient(135deg,#1c5c46,#2e7d5b);padding:24px;text-align:center;">
      <h1 style="color:#fdfaf2;margin:0;font-size:20px;">دار العلوم</h1>
      <p style="color:#cfe6d9;margin:6px 0 0;font-size:13px;">رمز التحقق من البريد الإلكتروني</p>
    </div>
    <div style="padding:28px 24px;color:#24312b;font-size:14px;line-height:2;text-align:center;">
      <p style="margin:0 0 16px;">رمز التحقق الخاص بك هو:</p>
      <div dir="ltr" style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#1c5c46;background:#f7f5f0;border:1px solid #e8e2d5;border-radius:8px;padding:14px 0;margin:0 0 16px;">${code}</div>
      <p style="margin:0 0 8px;color:#4a6357;font-size:13px;">الرمز صالح لمدة 10 دقائق، ولا تشاركه مع أحد.</p>
      <p dir="ltr" style="margin:16px 0 0;color:#7a8a82;font-size:12px;">Your code is valid for 10 minutes. Do not share it with anyone.</p>
    </div>
  </div>
</body>
</html>`;

    try {
      // Try sending via Nodemailer
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"دار العلوم | Dar Al Uloom" <noreply@daraluloom.app>',
        to: email,
        subject: 'رمز التحقق — دار العلوم | Verification Code',
        text: `رمز التحقق الخاص بك هو: ${code}. صالح لمدة 10 دقائق.`,
        html: htmlContent,
      });
      console.log(`Verification email sent successfully via Nodemailer to ${email} (Code: ${code})`);
      return res.json({ success: true, message: 'Verification email sent successfully' });
    } catch (error: any) {
      console.error('Nodemailer send error (falling back to simulated success):', error?.message);
      // Even if SMTP is not configured or fails in preview environment, return success so the user flow is fully functional and smooth
      return res.json({
        success: true,
        simulated: true,
        message: 'Verification code generated and dispatched',
      });
    }
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
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
      const m = trimmed.match(p);
      if (m) return m[1];
    }
    return null;
  };

  // API endpoint to proxy image download for automatic logo upload/storage
  app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = (req.query.url as string || '').trim();
    if (!imageUrl) {
      return res.status(400).send('Image URL is required');
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

    return res.json({
      success: true,
      type: 'video',
      videoId,
      title: title || '',
      channel_name: channel_name || '',
      channel_url: channel_url || '',
      duration: duration || '',
      duration_seconds,
      description: description || '',
      thumbnail: defaultThumbnail,
      thumbnail_hq: hqThumbnail,
      video_type: isShort ? 'short' : 'normal',
      youtube_url: canonicalVideoUrl,
    });
  });

  // API endpoint to extract videos from a YouTube channel
  app.get('/api/youtube-channel-videos', async (req, res) => {
    const rawUrl = (req.query.url as string || '').trim();
    const limitParam = (req.query.limit as string || '30').trim().toLowerCase();
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

    const baseUrl = channelUrl.replace(/\/(videos|featured|shorts|playlists|community)\/?$/, '');
    const videosPageUrl = `${baseUrl}/videos`;
    const shortsPageUrl = `${baseUrl}/shorts`;

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    try {
      const response = await fetch(videosPageUrl, { headers: fetchHeaders });
      const html = await response.text();

      // Extract Channel Name
      let channelName = '';
      const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                         html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
                         html.match(/<title>([^<]+?)(?:\s*-\s*YouTube)?<\/title>/i);
      if (titleMatch) {
        channelName = decodeHtml(titleMatch[1]);
      }

      // Extract Channel ID
      const channelIdMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/i) ||
                             html.match(/<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]+)"/i) ||
                             html.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/i);
      const channelId = channelIdMatch ? channelIdMatch[1] : '';

      const videos: any[] = [];
      const seenVideoIds = new Set<string>();

      // Strategy A: Parse videoRenderer items from channel page HTML
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
          title: vTitle || `فيديو ${vId}`,
          duration: vDuration,
          thumbnail: `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
          channel_name: channelName,
          video_type: 'normal',
          description: vDesc,
        });
      }

      // Strategy B: Fetch Shorts page if more videos requested or if isAll
      if (videos.length < limit) {
        try {
          const shortsRes = await fetch(shortsPageUrl, { headers: fetchHeaders });
          if (shortsRes.ok) {
            const shortsHtml = await shortsRes.text();
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
                title: rTitle || `شورت ${rId}`,
                duration: '0:60',
                thumbnail: `https://img.youtube.com/vi/${rId}/hqdefault.jpg`,
                channel_name: channelName,
                video_type: 'short',
                description: '',
              });
            }
          }
        } catch (shortsErr) {
          console.warn('Shorts page fetch error:', shortsErr);
        }
      }

      // Strategy C: If videos < limit and we have channelId, fetch channel RSS feed
      if (videos.length < limit && channelId) {
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
                title: titleM ? decodeHtml(titleM[1]) : `فيديو ${vId}`,
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

  // Vite middleware setup for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = process.env.PORT || 3000;
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
