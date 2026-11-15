# Hanami Extensions Repository 🌸

Official and community streaming extension repository for **[Hanami](https://github.com/Debojit-mitra/haname)**, an anime streaming app.

## 📦 How to Add this Repository in Hanami

1. Open **Hanami** on your device.
2. Go to **Settings** $\to$ **Extensions** $\to$ **Repositories**.
3. Tap **Add Custom Repository**.
4. Enter the Catalog URL:
   ```
   https://raw.githubusercontent.com/Debojit-mitra/hanami-extensions/main/index.json
   ```
5. Go to the **Browse** tab to install your favorite anime providers!

---

## 🚀 Available Extensions

| Extension | Audio | Type | Description |
|---|---|---|---|
| **Gogoanime** | Sub & Dub | HLS / Embed | High availability multi-server anime streams. |
| **Anikoto** | Sub & Dub | HLS / Embed | High quality streams with fast API resolution. |
| **AniZone** | Sub | HLS | Clean Vidstack direct HLS streams with soft subtitles. |
| **AniWaves** | Sub & Dub | Multi-server | Multi-server embeds and soft sub tracks. |
| **AnimeOnsen** | Sub | DASH / Soft subs | Multi-language soft subtitles and direct streaming. |
| **AnimeGG** | Sub & Dub | MP4 direct | Direct MP4 video streams. |

---

## 🛠️ Extension Specification

Each extension is a self-contained JavaScript bundle implementing the `HanamiExtension` interface:

```javascript
(function() {
  const MyExtension = {
    id: "my_extension",
    name: "My Extension",
    version: "1.0.0",
    versionCode: 1,
    audio: ["sub", "dub"],
    baseUrl: "https://example.com",
    description: "Stream anime from My Extension",

    async getEpisodes(meta) {
      // meta contains: anilistId, malId, titles { english, romaji, synonyms }, year, format
      // returns: Array of { number, title, ref, sub: true/false, dub: true/false }
    },

    async getStreams(episodeRef, audio) {
      // episodeRef: string (ref from getEpisodes)
      // audio: 'sub' | 'dub'
      // returns: { streams: [{ url, type: 'hls'|'mp4'|'embed', server, quality, headers, subtitles }] }
    }
  };

  registerExtension(MyExtension);
})();
```

### Injected Host APIs (`globalThis.hanami`)
* `hanami.http.get(url, options)` / `hanami.http.post(url, body, options)`
* `fetch(url, options)` (Standard Fetch API with native HTTP bypass for CORS)
* `hanami.crypto.aesDecryptCbc(ciphertext, key, iv)`
* `hanami.crypto.hmacSha256(data, key, encoding)`
* `hanami.crypto.base64UrlEncode(str)` / `base64UrlDecode(str)`
* `console.log`, `console.warn`, `console.error`

---

## 📄 License
MIT
