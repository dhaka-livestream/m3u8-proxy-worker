// ============================================================
//  Cloudflare Worker - HLS Proxy with 60-Second Expiry Token
//  URL Format: https://your-worker.workers.dev/starjalsha.m3u8
// ============================================================

// ------------------ URL ম্যাপিং (আপনার চ্যানেল লিস্ট) ------------------
const CHANNEL_MAP = {
  "starjalsha": "https://example.com/live/starjalsha.m3u8",
  "sports": "https://another-server.com/sports/playlist.m3u8",
  // নতুন চ্যানেল যোগ করুন, যেমন: "channel_name": "original_m3u8_url"
};

// ------------------ ইউটিলিটি ফাংশন ------------------
async function generateHmac(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function validateToken(segmentPath, expiry, token, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (now > expiry) return false;
  const expectedToken = await generateHmac(`${segmentPath}:${expiry}`, secret);
  return token === expectedToken;
}

// ------------------ m3u8 রিওরাইটার ------------------
async function rewriteM3U8(originalUrl, channelName, request, secret) {
  const response = await fetch(originalUrl, {
    headers: {
      'User-Agent': 'VLC/3.0.0',
      'Origin': new URL(originalUrl).origin,
      'Referer': originalUrl,
    }
  });

  if (!response.ok) {
    return new Response(`Origin fetch failed: ${response.status}`, { status: response.status });
  }

  const text = await response.text();
  const lines = text.split('\n');
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 60; // ১ মিনিট মেয়াদ

  const rewrittenLines = await Promise.all(lines.map(async (line) => {
    if (line.startsWith('#') || line.trim() === '') {
      return line;
    }

    let segmentUrl;
    try {
      segmentUrl = new URL(line, baseUrl).href;
    } catch {
      return line;
    }

    const urlObj = new URL(segmentUrl);
    const pathname = urlObj.pathname;
    
    const token = await generateHmac(`${pathname}:${expiry}`, secret);
    
    const workerBase = `https://${request.headers.get('host')}`;
    const newSegmentUrl = `${workerBase}/segment/${channelName}${pathname}?expiry=${expiry}&token=${token}`;
    
    return newSegmentUrl;
  }));

  return new Response(rewrittenLines.join('\n'), {
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

// ------------------ মেইন হ্যান্ডলার ------------------
export default {
  async fetch(request, env, ctx) {
    const SECRET = env.SECRET_KEY; // Environment variable থেকে নিচ্ছে
    if (!SECRET) {
      return new Response('Server configuration error: SECRET_KEY missing', { status: 500 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ------ রুট ১: চ্যানেলের m3u8 লোড করুন (যেমন: /starjalsha.m3u8) ------
    if (pathname.endsWith('.m3u8')) {
      const channelName = pathname.slice(1, -5); // "/starjalsha.m3u8" -> "starjalsha"
      
      if (CHANNEL_MAP[channelName]) {
        const originalM3U8 = CHANNEL_MAP[channelName];
        return await rewriteM3U8(originalM3U8, channelName, request, SECRET);
      }
    }

    // ------ রুট ২: টোকেন-সহ সেগমেন্ট লোড করুন (যেমন: /segment/starjalsha/stream/abc.ts) ------
    const pathParts = pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (pathParts.length >= 3 && pathParts[0] === 'segment') {
      const channelName = pathParts[1];
      const segmentRelativePath = '/' + pathParts.slice(2).join('/');
      
      const expiry = parseInt(url.searchParams.get('expiry'));
      const token = url.searchParams.get('token');

      if (!expiry || !token) {
        return new Response('Missing token or expiry', { status: 401 });
      }

      const isValid = await validateToken(segmentRelativePath, expiry, token, SECRET);
      if (!isValid) {
        return new Response('403 Forbidden: Token Expired or Invalid', { 
          status: 403,
          headers: { 'X-Error': 'Token expired' }
        });
      }

      const originalBase = CHANNEL_MAP[channelName];
      if (!originalBase) {
        return new Response('Channel not found', { status: 404 });
      }
      const baseUrl = originalBase.substring(0, originalBase.lastIndexOf('/') + 1);
      const originalSegmentUrl = new URL(segmentRelativePath, baseUrl).href;

      const segmentResponse = await fetch(originalSegmentUrl, {
        headers: {
          'User-Agent': 'VLC/3.0.0',
          'Origin': new URL(originalBase).origin,
        }
      });

      const newHeaders = new Headers(segmentResponse.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Access-Control-Allow-Origin', '*');
      
      return new Response(segmentResponse.body, {
        status: segmentResponse.status,
        headers: newHeaders
      });
    }

    // রুট ৩: কোনোটাই মেলেনি
    return new Response('Not Found', { status: 404 });
  }
};
