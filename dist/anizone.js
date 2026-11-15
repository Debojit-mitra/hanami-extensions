/**
 * AniZone Extension for Hanami
 * Version: 1.0.0
 * Audio: Sub
 */
(function() {
  const BASE = "https://anizone.to";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };

  function decodeJsonArg(raw) {
    if (!raw) return null;
    try {
      var val = raw.replace(/\\\\u([0-9a-fA-F]{4})/g, function(_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      });
      return JSON.parse(val);
    } catch (_) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
  }

  const AnizoneExtension = {
    id: "anizone",
    name: "AniZone",
    version: "1.0.0",
    versionCode: 1,
    author: "Hanami Community",
    audio: ["sub"],
    baseUrl: BASE,
    description: "Direct HLS streams with integrated soft subtitles from AniZone.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      let targetSlug = null;

      // 1. Search AniZone
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/anime?search=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const itemsMatch = html.match(/items\s*:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/i);
          if (itemsMatch) {
            const items = decodeJsonArg(itemsMatch[1]);
            if (Array.isArray(items) && items.length > 0) {
              targetSlug = items[0].slug;
              break;
            }
          }
        } catch (e) {
          console.warn("AniZone search error:", e.message);
        }
      }

      if (!targetSlug) {
        targetSlug = meta.titles.romaji.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }

      // 2. Fetch anime page & parse episode items
      const episodes = [];
      try {
        const pageUrl = BASE + "/anime/" + targetSlug;
        const res = await fetch(pageUrl, { headers: HEADERS });
        const html = await res.text();

        const itemsMatch = html.match(/items\s*:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/i);
        if (itemsMatch) {
          const items = decodeJsonArg(itemsMatch[1]);
          if (Array.isArray(items)) {
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const epNum = i + 1;
              const epSlug = item.slug || (targetSlug + "/" + epNum);

              episodes.push({
                number: epNum,
                title: item.title || ("Episode " + epNum),
                ref: epSlug,
                sub: true,
                dub: false
              });
            }
          }
        }
      } catch (e) {
        console.warn("AniZone getEpisodes error:", e.message);
      }

      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];

      try {
        const epUrl = BASE + "/anime/" + episodeRef;
        const res = await fetch(epUrl, { headers: HEADERS });
        const html = await res.text();

        // Extract Vidstack player JSON
        const playerMatch = html.match(/vidstackPlayer\s*\(\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)\s*\)/i);
        if (playerMatch) {
          const data = decodeJsonArg(playerMatch[1]);
          if (data && data.src) {
            const subs = [];
            if (Array.isArray(data.subtitles)) {
              for (const s of data.subtitles) {
                if (s.file) {
                  subs.push({
                    url: s.file,
                    label: s.title || s.language || "English",
                    srclang: s.language || "en",
                    default: Boolean(s.default)
                  });
                }
              }
            }

            streams.push({
              url: data.src,
              type: "hls",
              server: "AniZone HLS",
              quality: "1080p",
              headers: { "Referer": BASE + "/" },
              subtitles: subs
            });
          }
        }
      } catch (e) {
        console.warn("AniZone getStreams error:", e.message);
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(AnizoneExtension);
})();
