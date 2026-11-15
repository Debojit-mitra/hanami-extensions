/**
 * Gogoanime Extension for Hanami
 * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://gogoanime.or.at";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };

  function normalize(str) {
    return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

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

  const GogoanimeExtension = {
    id: "gogoanime",
    name: "Gogoanime",
    version: "1.0.1",
    versionCode: 2,
    author: "Hanami Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Stream sub and dub anime with high availability.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      const targetNorm = normalize(meta.titles.english || meta.titles.romaji);
      let bestSubSlug = null;
      let bestDubSlug = null;

      // 1. Search candidate anime
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/?s=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex = /<a[^>]+href="https:\/\/gogoanime\.or\.at\/anime\/([^"/]+)\/?"[^>]*title="([^"]*)"/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            const slug = match[1];
            const title = cleanTitle(match[2]);
            const isDub = slug.endsWith("-dub") || /\(dub\)/i.test(title);
            const baseSlug = isDub ? slug.replace(/-dub$/, "") : slug;
            const norm = normalize(baseSlug.replace(/-/g, " "));

            if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
              if (isDub && !bestDubSlug) bestDubSlug = slug;
              if (!isDub && !bestSubSlug) bestSubSlug = slug;
            }
          }

          if (bestSubSlug) break;
        } catch (e) {
          console.warn("Gogoanime search error:", e.message);
        }
      }

      if (!bestSubSlug && !bestDubSlug) {
        bestSubSlug = meta.titles.romaji.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }

      const episodesMap = new Map();

      async function fetchEpisodesFromSlug(slug, isDub) {
        if (!slug) return;
        try {
          const pageUrl = BASE + "/anime/" + slug + "/";
          const res = await fetch(pageUrl, { headers: HEADERS });
          if (!res.ok) return;
          const html = await res.text();

          const liRegex = /<li[^>]*data-index="[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
          let liMatch;
          while ((liMatch = liRegex.exec(html)) !== null) {
            const liContent = liMatch[1];
            const hrefMatch = liContent.match(/<a\s+href="([^"]+)"/i);
            const numMatch = liContent.match(/<div class="epl-num">([^<]+)<\/div>/i);
            if (!hrefMatch || !numMatch) continue;

            const url = hrefMatch[1];
            const num = parseInt(numMatch[1].trim(), 10);
            if (isNaN(num) || num < 1) continue;

            const titleMatch = liContent.match(/<div class="epl-title">([\s\S]*?)<\/div>/i);
            const epTitle = titleMatch ? cleanTitle(titleMatch[1]) : "Episode " + num;

            if (!episodesMap.has(num)) {
              episodesMap.set(num, {
                number: num,
                title: epTitle,
                ref: url,
                sub: !isDub,
                dub: isDub
              });
            } else {
              const existing = episodesMap.get(num);
              if (isDub) existing.dub = true;
              else existing.sub = true;
            }
          }
        } catch (e) {
          console.warn("Gogoanime fetch episodes error for " + slug + ":", e.message);
        }
      }

      await fetchEpisodesFromSlug(bestSubSlug, false);
      if (bestDubSlug && bestDubSlug !== bestSubSlug) {
        await fetchEpisodesFromSlug(bestDubSlug, true);
      }

      const list = Array.from(episodesMap.values());
      list.sort((a, b) => a.number - b.number);
      return list;
    },

    async getStreams(episodeRef, audio) {
      let targetUrl = episodeRef;
      if (audio === "dub" && !targetUrl.includes("-dub")) {
        const dubCandidate = targetUrl.replace(/-episode-(\d+)/, "-dub-episode-$1");
        try {
          const testRes = await fetch(dubCandidate, { headers: HEADERS });
          if (testRes.ok) targetUrl = dubCandidate;
        } catch (_) {}
      }

      const res = await fetch(targetUrl, { headers: HEADERS });
      const html = await res.text();

      const streams = [];
      const origin = function(u) {
        try {
          const parts = u.split("/");
          return parts[0] + "//" + parts[2];
        } catch (_) {
          return BASE;
        }
      };

      // Direct player iframe with player.php?m3u8=
      const m3u8Match = html.match(/player\.php\?m3u8=([^"&'\s]+)/i);
      if (m3u8Match) {
        const m3u8Url = decodeURIComponent(m3u8Match[1]);
        const subMatch = html.match(/subtitle=([^"&'\s]+)/i);
        const subs = [];
        if (subMatch) {
          subs.push({
            url: decodeURIComponent(subMatch[1]),
            label: "English",
            srclang: "en",
            default: true
          });
        }
        streams.push({
          url: m3u8Url,
          type: "hls",
          server: "Gogo Server",
          quality: "1080p",
          headers: { "Referer": origin(targetUrl) + "/" },
          subtitles: subs
        });
      }

      // Parse server list
      const serverRegex = /<li[^>]*class="server"[^>]*data-video="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
      let sMatch;
      while ((sMatch = serverRegex.exec(html)) !== null) {
        let embed = sMatch[1];
        if (embed.startsWith("//")) embed = "https:" + embed;
        const serverName = cleanTitle(sMatch[2]) || "Server";

        if (embed.includes("player.php?m3u8=")) {
          const uMatch = embed.match(/m3u8=([^&]+)/);
          if (uMatch) {
            streams.push({
              url: decodeURIComponent(uMatch[1]),
              type: "hls",
              server: serverName,
              headers: { "Referer": origin(embed) + "/" }
            });
          }
        } else {
          streams.push({
            url: embed,
            type: "embed",
            server: serverName,
            headers: { "Referer": origin(targetUrl) + "/" }
          });
        }
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(GogoanimeExtension);
})();
