# M3U8 Proxy Worker with 60-Second Expiry Token

This Cloudflare Worker acts as a secure proxy for HLS (m3u8) streams. It rewrites the internal `.ts` segment URLs to include a time-based HMAC token that expires in **60 seconds**, preventing users from extracting and reusing the original source links.

## ✨ Features
- **Path-Based Routing**: Use clean URLs like `https://worker.domain/starjalsha.m3u8`
- **Auto Token Generation**: Each `.ts` segment gets a unique token.
- **Auto Expiry**: Tokens expire 60 seconds after the m3u8 is fetched. Old links return `403 Forbidden`.
- **Header Forwarding**: Adds necessary `Origin` and `Referer` headers to avoid source blocking.

## 📦 Deployment (via GitHub)

1. **Fork or Clone** this repository to your GitHub account.
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create Application** → **Workers** → **Import a repository**.
3. Select this repository and click **Deploy**.
4. Go to your Worker's **Settings** → **Variables** and add a **Secret** variable:
   - Name: `SECRET_KEY`
   - Value: (Generate a random strong string, e.g., `JhGd7sK2pQ9vLx5mN8wR3tY6`)

## 🛠️ Configuration (Edit `index.js`)

Update the `CHANNEL_MAP` object with your own channel names and source URLs:

```javascript
const CHANNEL_MAP = {
  "starjalsha": "https://example.com/live/starjalsha.m3u8",
  "sports": "https://another-server.com/sports/playlist.m3u8",
};
