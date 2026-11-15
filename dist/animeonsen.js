/**
 * AnimeOnsen Extension for Hanami
 * Version: 1.0.0
 * Audio: Sub
 */
(function() {
  const SITE = "https://www.animeonsen.xyz";

  let session = null;

  async function getSession() {
    if (session) return session;

    try {
      const res = await fetch(SITE + "/", {
        headers: { "Accept": "text/html,application/xhtml+xml" }
      });
      const html = await res.text();

      function metaContent(name) {
        const re = new RegExp('<meta[^>]*name=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', "i");
        const m = html.match(re);
        if (m) return m[1];
        const reRev = new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*name=["\']' + name + '["\']', "i");
        const mRev = html.match(reRev);
        return mRev ? mRev[1] : "";
      }

      const apiOrigin = metaContent("ao-api-origin") || "https://api.animeonsen.xyz";
      const searchOrigin = metaContent("ao-search-origin") || "https://search.animeonsen.xyz";
      const searchToken = metaContent("ao-search-token");

      session = {
        apiOrigin: apiOrigin,
        searchOrigin: searchOrigin,
        searchToken: searchToken
      };
      return session;
    } catch (e) {
      console.warn("AnimeOnsen session init error:", e.message);
      return {
        apiOrigin: "https://api.animeonsen.xyz",
        searchOrigin: "https://search.animeonsen.xyz",
        searchToken: ""
      };
    }
  }

  const AnimeOnsenExtension = {
    id: "animeonsen",
    name: "AnimeOnsen",
    version: "1.0.0",
    versionCode: 1,
    author: "Hanami Community",
    audio: ["sub"],
    baseUrl: SITE,
    description: "High quality streaming with multi-language soft subtitles from AnimeOnsen.",

    async getEpisodes(meta) {
      const sess = await getSession();
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      let contentId = null;

      // 1. Search Meilisearch
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = sess.searchOrigin + "/multi-search";
          const res = await fetch(searchUrl, {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + sess.searchToken,
              "Content-Type": "application/json",
              "Accept": "application/json",
              "Origin": SITE,
              "Referer": SITE + "/"
            },
            body: JSON.stringify({
              queries: [{ indexUid: "content", q: query, limit: 10 }]
            })
          });
          const data = await res.json();
          const hits = data && data.results && data.results[0] ? data.results[0].hits : [];

          if (Array.isArray(hits) && hits.length > 0) {
            contentId = hits[0].content_id;
            break;
          }
        } catch (e) {
          console.warn("AnimeOnsen search error:", e.message);
        }
      }

      if (!contentId) return [];

      // 2. Fetch episodes list
      const episodes = [];
      try {
        const epUrl = sess.apiOrigin + "/v4/content/" + encodeURIComponent(contentId) + "/episodes";
        const res = await fetch(epUrl, {
          headers: { "Origin": SITE, "Referer": SITE + "/" }
        });
        const data = await res.json();

        if (data && typeof data === "object") {
          const keys = Object.keys(data);
          keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

          for (const key of keys) {
            const num = parseInt(key, 10);
            if (isNaN(num)) continue;
            const epData = data[key];
            const title = (epData && epData.contentTitle_episode_en) || ("Episode " + num);

            episodes.push({
              number: num,
              title: title,
              ref: contentId + ":" + key,
              sub: true,
              dub: false
            });
          }
        }
      } catch (e) {
        console.warn("AnimeOnsen parse episodes error:", e.message);
      }

      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const sess = await getSession();
      const parts = episodeRef.split(":");
      const contentId = parts[0];
      const epNum = parts[1] || parts[0];

      const streams = [];

      try {
        const videoUrl = sess.apiOrigin + "/v4/content/" + encodeURIComponent(contentId) + "/video/" + encodeURIComponent(epNum);
        const res = await fetch(videoUrl, {
          headers: { "Origin": SITE, "Referer": SITE + "/" }
        });
        const data = await res.json();

        if (data && data.uri && data.uri.stream) {
          const streamUrl = data.uri.stream;
          const subs = [];

          if (data.uri.subtitles && typeof data.uri.subtitles === "object") {
            const labels = (data.metadata && data.metadata.subtitles) || {};
            for (const lang in data.uri.subtitles) {
              subs.push({
                url: data.uri.subtitles[lang],
                label: labels[lang] || lang,
                srclang: lang,
                default: lang.startsWith("en")
              });
            }
          }

          const streamType = streamUrl.includes(".m3u8") ? "hls" : (streamUrl.includes(".mpd") ? "dash" : "mp4");

          streams.push({
            url: streamUrl,
            type: streamType,
            server: "AnimeOnsen Direct",
            quality: "1080p",
            headers: { "Origin": SITE, "Referer": SITE + "/" },
            subtitles: subs
          });
        }
      } catch (e) {
        console.warn("AnimeOnsen getStreams error:", e.message);
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(AnimeOnsenExtension);
})();
