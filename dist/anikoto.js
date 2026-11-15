/**
 * Anikoto Extension for Hanami
 * Version: 1.0.2
 * Audio: Sub & Dub
 */
(function () {
  const ANIKOTO = "https://anikototv.bz";
  const HEADERS = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: ANIKOTO + "/",
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
    version: "1.0.2",
    versionCode: 3,
    author: "Hanami Community",
    audio: ["sub", "dub"],
    baseUrl: ANIKOTO,
    description: "Fast high-quality multi-source streams from Anikoto.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles && meta.titles.english,
        meta.titles && meta.titles.romaji,
        ...(meta.titles && meta.titles.synonyms || []),
      ].filter(Boolean);

      let targetSlug = null;

      // 1. Search candidate anime
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl =
            ANIKOTO + "/filter?keyword=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex =
            /<a\s+class="name d-title"\s+href="(?:https?:\/\/[^"/]+)?\/watch\/([^"/]+)(?:\/ep-\d+)?"[^>]*data-jp="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
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
        const fallback = (meta.titles && (meta.titles.romaji || meta.titles.english)) || "";
        targetSlug = fallback
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      }

      // 2. Fetch anime watch page to get showId
      const episodes = [];
      try {
        const watchUrl = ANIKOTO + "/watch/" + targetSlug;
        const res = await fetch(watchUrl, { headers: HEADERS });
        const html = await res.text();

        const showIdMatch = html.match(/data-id="(\d+)"/);
        const showId = showIdMatch ? showIdMatch[1] : null;

        if (showId) {
          // Fetch episode list via AJAX
          const epListUrl = ANIKOTO + "/ajax/episode/list/" + showId;
          const listRes = await fetch(epListUrl, {
            headers: Object.assign({}, HEADERS, {
              "X-Requested-With": "XMLHttpRequest",
              Referer: watchUrl,
            }),
          });
          const listData = await listRes.json();
          const listHtml = listData && listData.result ? listData.result : "";

          const epRegex = /<a\s+[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
          let epMatch;
          while ((epMatch = epRegex.exec(listHtml)) !== null) {
            const tag = epMatch[0];
            const getAttr = function (name) {
              const m = tag.match(new RegExp("data-" + name + '="([^"]*)"'));
              return m ? m[1] : "";
            };

            const num = parseInt(getAttr("num"), 10);
            if (isNaN(num)) continue;

            const titleMatch = epMatch[2]
              ? epMatch[2].match(
                  /<span\s+class="d-title"[^>]*>([\s\S]*?)<\/span>/i,
                )
              : null;
            const title = titleMatch
              ? cleanTitle(titleMatch[1])
              : "Episode " + num;

            episodes.push({
              number: num,
              title: title,
              ref: getAttr("ids") || getAttr("id") || String(num),
              sub: getAttr("sub") === "1" || true,
              dub: getAttr("dub") === "1",
            });
          }
        }
      } catch (e) {
        console.warn("Anikoto parse episodes error:", e.message);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];
      let intro = null;
      let outro = null;

      try {
        const serverListUrl =
          ANIKOTO +
          "/ajax/server/list?servers=" +
          encodeURIComponent(episodeRef);
        const res = await fetch(serverListUrl, {
          headers: Object.assign({}, HEADERS, {
            "X-Requested-With": "XMLHttpRequest",
            Referer: ANIKOTO + "/",
          }),
        });
        const data = await res.json();
        const serverHtml = data && data.result ? data.result : "";

        // Parse servers by audio type
        const typeRegex =
          /<div\s+class="type"\s+data-type="([^"]+)">([\s\S]*?)<\/ul>\s*<\/div>/gi;
        let typeMatch;
        const linkIds = [];
        while ((typeMatch = typeRegex.exec(serverHtml)) !== null) {
          const typeName = typeMatch[1];
          if (
            typeName !== audio &&
            !(audio === "sub" && typeName === "hsub")
          ) {
            continue;
          }

          const liRegex =
            /<li\s+[^>]*data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
          let liMatch;
          while ((liMatch = liRegex.exec(typeMatch[2])) !== null) {
            linkIds.push({
              linkId: liMatch[1],
              name: cleanTitle(liMatch[2]) || "Server",
            });
          }
        }

        for (const s of linkIds.slice(0, 3)) {
          const sRes = await fetch(
            ANIKOTO + "/ajax/server?get=" + encodeURIComponent(s.linkId),
            {
              headers: Object.assign({}, HEADERS, {
                "X-Requested-With": "XMLHttpRequest",
                Referer: ANIKOTO + "/",
              }),
            },
          );
          const sData = await sRes.json();
          const embedUrl = sData && sData.result ? sData.result.url : null;
          if (embedUrl) {
            streams.push({
              url: embedUrl,
              type: embedUrl.includes(".m3u8") ? "hls" : "embed",
              server: s.name,
              headers: { Referer: ANIKOTO + "/" },
            });

            if (
              !intro &&
              sData.result.skip_data &&
              Array.isArray(sData.result.skip_data.intro) &&
              sData.result.skip_data.intro.length === 2
            ) {
              intro = {
                start: sData.result.skip_data.intro[0],
                end: sData.result.skip_data.intro[1],
              };
            }
            if (
              !outro &&
              sData.result.skip_data &&
              Array.isArray(sData.result.skip_data.outro) &&
              sData.result.skip_data.outro.length === 2
            ) {
              outro = {
                start: sData.result.skip_data.outro[0],
                end: sData.result.skip_data.outro[1],
              };
            }
          }
        }
      } catch (e) {
        console.warn("Anikoto getStreams error:", e.message);
      }

      return {
        streams: streams,
        intro: intro,
        outro: outro,
      };
    },
  };

  registerExtension(AnikotoExtension);
})();
