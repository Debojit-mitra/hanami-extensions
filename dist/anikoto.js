/**
 * Anikoto Extension for Hanami
 * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const ANIKOTO = "https://anikototv.to";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": ANIKOTO + "/"
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

  const AnikotoExtension = {
    id: "anikoto",
    name: "Anikoto",
    version: "1.0.0",
    versionCode: 1,
    author: "Hanami Community",
    audio: ["sub", "dub"],
    baseUrl: ANIKOTO,
    description: "Fast high-quality multi-source streams from Anikoto.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      let targetSlug = null;

      // 1. Search candidate anime
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = ANIKOTO + "/filter?keyword=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex = /<a\s+class="name d-title"\s+href="(?:https:\/\/anikototv\.to)?\/watch\/([^"/]+)(?:\/ep-\d+)?"[^>]*data-jp="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            targetSlug = match[1];
            break;
          }

          if (targetSlug) break;
        } catch (e) {
          console.warn("Anikoto search error:", e.message);
        }
      }

      if (!targetSlug) {
        targetSlug = meta.titles.romaji.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }

      // 2. Fetch anime page & parse episode list
      const episodes = [];
      try {
        const watchUrl = ANIKOTO + "/watch/" + targetSlug;
        const res = await fetch(watchUrl, { headers: HEADERS });
        const html = await res.text();

        const epRegex = /<a\s+[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let epMatch;
        while ((epMatch = epRegex.exec(html)) !== null) {
          const tag = epMatch[0];
          const getAttr = function(name) {
            var m = tag.match(new RegExp('data-' + name + '="([^"]*)"'));
            return m ? m[1] : "";
          };

          const num = parseInt(getAttr("num"), 10);
          if (isNaN(num)) continue;

          const titleMatch = epMatch[2] ? epMatch[2].match(/<span\s+class="d-title"[^>]*>([\s\S]*?)<\/span>/i) : null;
          const title = titleMatch ? cleanTitle(titleMatch[1]) : "Episode " + num;

          episodes.push({
            number: num,
            title: title,
            ref: getAttr("ids") || getAttr("id") || String(num),
            sub: getAttr("sub") === "1" || true,
            dub: getAttr("dub") === "1"
          });
        }
      } catch (e) {
        console.warn("Anikoto parse episodes error:", e.message);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];

      try {
        const serversUrl = ANIKOTO + "/ajax/episode/servers?episodeId=" + encodeURIComponent(episodeRef);
        const res = await fetch(serversUrl, { headers: HEADERS });
        const data = await res.json();
        const html = data && data.html ? data.html : "";

        const serverRegex = /<div\s+[^>]*class="server-item[^"]*"[^>]*data-id="([^"]+)"[^>]*data-type="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi;
        let match;
        const serverIds = [];

        while ((match = serverRegex.exec(html)) !== null) {
          const sId = match[1];
          const sType = match[2];
          const name = cleanTitle(match[3]) || "Server";

          if (audio === "dub" && sType !== "dub") continue;
          if (audio === "sub" && sType === "dub") continue;

          serverIds.push({ id: sId, name: name });
        }

        for (const s of serverIds.slice(0, 3)) {
          const sourceUrl = ANIKOTO + "/ajax/episode/sources?id=" + encodeURIComponent(s.id);
          const sRes = await fetch(sourceUrl, { headers: HEADERS });
          const sData = await sRes.json();

          if (sData && sData.link) {
            let embedUrl = sData.link;

            // Direct m3u8 base64 encoded: #aHR0c...
            if (embedUrl.includes("#aHR0c")) {
              try {
                const b64 = embedUrl.split("#")[1];
                const decoded = await hanami.crypto.base64UrlDecode(b64);
                if (decoded && decoded.includes(".m3u8")) {
                  streams.push({
                    url: decoded,
                    type: "hls",
                    server: s.name,
                    quality: "1080p",
                    headers: { "Referer": ANIKOTO + "/" }
                  });
                  continue;
                }
              } catch (_) {}
            }

            streams.push({
              url: embedUrl,
              type: "embed",
              server: s.name,
              headers: { "Referer": ANIKOTO + "/" }
            });
          }
        }
      } catch (e) {
        console.warn("Anikoto getStreams error:", e.message);
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(AnikotoExtension);
})();
