/**
 * AniWaves Extension for Hanami
 * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://aniwaves.ru";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };
  const AJAX_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
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

  const AniwavesExtension = {
    id: "aniwaves",
    name: "AniWaves",
    version: "1.0.0",
    versionCode: 1,
    author: "Hanami Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Stream anime from AniWaves with multi-server embeds and soft subs.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      let targetSlug = null;
      let siteId = null;

      // 1. Search candidate
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/filter?keyword=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex = /<a\s+[^>]*class="[^"]*name\s+d-title[^"]*"[^>]*href="\/watch\/([a-z0-9-]+)"/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            targetSlug = match[1];
            const idMatch = targetSlug.match(/-(\d+)$/);
            if (idMatch) {
              siteId = idMatch[1];
              break;
            }
          }

          if (targetSlug && siteId) break;
        } catch (e) {
          console.warn("AniWaves search error:", e.message);
        }
      }

      if (!siteId) return [];

      // 2. Fetch episode list via AJAX
      const episodes = [];
      try {
        const epListUrl = BASE + "/ajax/episode/list/" + siteId + "?vrf=";
        const res = await fetch(epListUrl, {
          headers: Object.assign({}, AJAX_HEADERS, { "Referer": BASE + "/watch/" + targetSlug })
        });
        const data = await res.json();
        const html = data && data.result ? data.result : "";

        const aRegex = /<a\s+[^>]*data-ids="([^"]*)"[^>]*data-num="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let epMatch;
        while ((epMatch = aRegex.exec(html)) !== null) {
          const tag = epMatch[0];
          const num = parseInt(epMatch[2], 10);
          if (isNaN(num)) continue;

          const slugMatch = tag.match(/data-slug="([^"]*)"/);
          const epSlug = slugMatch ? slugMatch[1] : String(num);
          const title = cleanTitle(epMatch[3]).replace(/^\d+\s*/, "") || "Episode " + num;

          const hasSub = tag.includes('data-sub="1"');
          const hasDub = tag.includes('data-dub="1"');

          episodes.push({
            number: num,
            title: title,
            ref: siteId + ":" + epSlug,
            sub: hasSub,
            dub: hasDub
          });
        }
      } catch (e) {
        console.warn("AniWaves parse episodes error:", e.message);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const parts = episodeRef.split(":");
      const siteId = parts[0];
      const epSlug = parts[1] || parts[0];

      const streams = [];
      const referer = BASE + "/watch/anime-" + siteId + "/ep-" + epSlug;

      try {
        const serverListUrl = BASE + "/ajax/server/list?servers=" + siteId + "&eps=" + encodeURIComponent(epSlug);
        const res = await fetch(serverListUrl, {
          headers: Object.assign({}, AJAX_HEADERS, { "Referer": referer })
        });
        const data = await res.json();
        const html = data && data.result ? data.result : "";

        // Parse servers
        const liRegex = /<li\s+[^>]*data-link-id="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi;
        let match;
        const linkIds = [];
        while ((match = liRegex.exec(html)) !== null) {
          linkIds.push({
            id: match[1],
            name: cleanTitle(match[2]) || "Server"
          });
        }

        for (const s of linkIds.slice(0, 3)) {
          const sourceUrl = BASE + "/ajax/sources?id=" + encodeURIComponent(s.id) + "&asi=0&autoPlay=0";
          const sRes = await fetch(sourceUrl, {
            headers: Object.assign({}, AJAX_HEADERS, { "Referer": referer })
          });
          const sData = await sRes.json();
          const embedUrl = sData && sData.result ? sData.result.url : null;

          if (embedUrl) {
            streams.push({
              url: embedUrl,
              type: "embed",
              server: s.name,
              headers: { "Referer": referer }
            });
          }
        }
      } catch (e) {
        console.warn("AniWaves getStreams error:", e.message);
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(AniwavesExtension);
})();
