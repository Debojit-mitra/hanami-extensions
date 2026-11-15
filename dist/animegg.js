/**
 * AnimeGG Extension for Hanami
 * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://www.animegg.org";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };

  function cleanTitle(str) {
    return (str || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  const AnimeggExtension = {
    id: "animegg",
    name: "AnimeGG",
    version: "1.0.0",
    versionCode: 1,
    author: "Hanami Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Fast direct MP4 video streams from AnimeGG.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      let targetSlug = null;

      // 1. Search AnimeGG
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/search/?q=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex = /<a\s+[^>]*class="[^"]*mse[^"]*"[^>]*href="\/series\/([^/?#]+)"/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            targetSlug = match[1];
            break;
          }

          if (targetSlug) break;
        } catch (e) {
          console.warn("AnimeGG search error:", e.message);
        }
      }

      if (!targetSlug) return [];

      // 2. Scrape series episodes
      const episodes = [];
      try {
        const seriesUrl = BASE + "/series/" + targetSlug;
        const res = await fetch(seriesUrl, { headers: HEADERS });
        const html = await res.text();

        const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
        let liMatch;
        const seen = new Set();

        while ((liMatch = liRegex.exec(html)) !== null) {
          const content = liMatch[1];
          if (!content.includes("anm_det_pop")) continue;

          const hrefMatch = content.match(/href="\/([^"#]+)/);
          const strongMatch = content.match(/<strong>([\s\S]*?)<\/strong>/);
          if (!hrefMatch || !strongMatch) continue;

          const href = hrefMatch[1];
          const strongText = cleanTitle(strongMatch[1]);
          const numMatch = strongText.match(/(\d+)\s*$/);
          if (!numMatch) continue;

          const num = parseInt(numMatch[1], 10);
          if (isNaN(num) || seen.has(num)) continue;
          seen.add(num);

          const titleMatch = content.match(/class="[^"]*anititle[^"]*"[^>]*>([\s\S]*?)<\/i>/i);
          const title = titleMatch ? cleanTitle(titleMatch[1]) : ("Episode " + num);

          const isSub = content.includes("btn-subbed");
          const isDub = content.includes("btn-dubbed");

          episodes.push({
            number: num,
            title: title,
            ref: href,
            sub: isSub || !isDub,
            dub: isDub
          });
        }
      } catch (e) {
        console.warn("AnimeGG parse episodes error:", e.message);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];

      try {
        const epUrl = BASE + "/" + episodeRef;
        const res = await fetch(epUrl, { headers: HEADERS });
        const html = await res.text();

        const aRegex = /<a\s+[^>]*data-id="([^"]*)"[^>]*data-mirror="([^"]*)"[^>]*data-version="([^"]*)"[^>]*>/gi;
        let match;
        const embeds = [];

        while ((match = aRegex.exec(html)) !== null) {
          const embedId = match[1];
          const mirror = match[2] || "Server";
          const version = match[3] || "subbed";

          if (audio === "dub" && !version.startsWith("dub")) continue;
          if (audio === "sub" && version.startsWith("dub")) continue;

          embeds.push({ id: embedId, server: mirror });
        }

        for (const e of embeds.slice(0, 3)) {
          const embedUrl = BASE + "/embed/" + e.id;
          const eRes = await fetch(embedUrl, {
            headers: Object.assign({}, HEADERS, { "Referer": BASE + "/" })
          });
          const eHtml = await eRes.text();

          const rawMatch = eHtml.match(/var\s+videoSources\s*=\s*(\[[\s\S]*?\]);/);
          if (rawMatch) {
            try {
              const rawJson = rawMatch[1]
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
                .replace(/:\s*'([^']*)'/g, ': "$1"');
              const sources = JSON.parse(rawJson);

              if (Array.isArray(sources)) {
                for (const s of sources) {
                  if (s && s.file) {
                    const videoUrl = s.file.startsWith("http") ? s.file : (BASE + s.file);
                    streams.push({
                      url: videoUrl,
                      type: videoUrl.includes(".m3u8") ? "hls" : "mp4",
                      server: e.server + (s.label ? " · " + s.label : ""),
                      quality: s.label || "720p",
                      headers: { "Referer": BASE + "/" }
                    });
                  }
                }
              }
            } catch (_) {}
          }
        }
      } catch (e) {
        console.warn("AnimeGG getStreams error:", e.message);
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(AnimeggExtension);
})();
