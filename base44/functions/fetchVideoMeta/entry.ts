import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

function extractVideoId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const videoId = extractVideoId(body?.url);
    if (!videoId) return Response.json({ error: 'رابط يوتيوب غير صالح' }, { status: 400 });

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // oEmbed gives title, channel name and thumbnail — no API key needed
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
    );
    if (!oembedRes.ok) {
      return Response.json({ error: 'تعذر جلب بيانات الفيديو من يوتيوب' }, { status: 502 });
    }
    const meta = await oembedRes.json();

    // Duration — best-effort parse from the public watch page
    let duration = null;
    try {
      const pageRes = await fetch(watchUrl, { headers: { 'Accept-Language': 'ar,en;q=0.8' } });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const m = html.match(/"lengthSeconds":"(\d+)"/);
        if (m) duration = formatDuration(Number(m[1]));
      }
    } catch (e) {
      /* duration is optional */
    }

    return Response.json({
      title: meta.title || null,
      channel_name: meta.author_name || null,
      thumbnail: meta.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}