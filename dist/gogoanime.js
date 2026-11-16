/**
 * Gogoanime Extension for Hanami
 * Version: 1.0.2
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://gogoanime.or.at";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };

  function normalize(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
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

  function base64urlToBase64(str) {
    let b64 = (str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return b64;
  }

  function scoreCandidate(cand, primaryEn, primaryRom, synonyms) {
    let score = 0;
    const synList = synonyms || [];
    const candNameNorm = normalize(cand.name);
    const candSlugNorm = normalize(cand.baseSlug);

    const normEn = normalize(primaryEn || "");
    const normRom = normalize(primaryRom || "");

    if (normEn && candNameNorm === normEn) score += 1000;
    if (normRom && candNameNorm === normRom) score += 900;
    if (normEn && candSlugNorm === normEn) score += 950;
    if (normRom && candSlugNorm === normRom) score += 850;

    const targetText = ((primaryEn || "") + " " + (primaryRom || "") + " " + synList.join(" ")).toLowerCase();

    const modifiers = [
      "season 2",
      "season 3",
      "season 4",
      "season 5",
      "season 6",
      "2nd season",
      "3rd season",
      "4th season",
      "5th season",
      "part 2",
      "part 3",
      "part 4",
      "cour 2",
      "movie",
      "film",
      "ova",
      "special",
      "specials"
    ];

    for (const mod of modifiers) {
      const modNorm = normalize(mod);
      const candHasMod = candNameNorm.includes(modNorm) || candSlugNorm.includes(modNorm);
      const targetHasMod = targetText.includes(mod);
      if (candHasMod && targetHasMod) score += 500;
      if (candHasMod && !targetHasMod) score -= 600;
      if (!candHasMod && targetHasMod) score -= 400;
    }

    const allTitles = [primaryEn, primaryRom].concat(synList);
    for (const t of allTitles) {
      const normT = normalize(t || "");
      if (!normT || normT.length < 3) continue;
      if (candNameNorm === normT) score += 200;
      else if (candNameNorm.includes(normT) || normT.includes(candNameNorm)) score += 60;
      if (candSlugNorm === normT) score += 150;
      else if (candSlugNorm.includes(normT) || normT.includes(candSlugNorm)) score += 50;
    }

    return score;
  }

  /* ── MegaPlay Direct HLS Extractor (Native Hanami Crypto) ────────── */
  async function extractMegaPlay(embedUrl, audio) {
    const originMatch = embedUrl.match(/^(https?:\/\/[^/]+)/);
    const origin = originMatch ? originMatch[1] : "https://megaplay.buzz";

    const pageRes = await fetch(embedUrl, {
      headers: { Referer: "https://hianimes.re/" }
    });
    const pageHtml = await pageRes.text();
    const fileId = (pageHtml.match(/data-id=["']([^"']+)["']/i) || [])[1];
    if (!fileId) throw new Error("MegaPlay fileId not found");

    const scriptUrls = [];
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let sm;
    while ((sm = scriptRegex.exec(pageHtml)) !== null) {
      const sUrl = sm[1].startsWith("http") ? sm[1] : origin + (sm[1].startsWith("/") ? "" : "/") + sm[1];
      scriptUrls.push(sUrl);
    }

    let encKey = "i?LMTAx0Q6,:}50U";
    let encIv = "W0;27ToaUpl_P%'c";
    let tokenSecret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

    for (const u of scriptUrls) {
      if (u.includes("e1-player") || u.includes("newclient") || u.includes("app.main")) {
        try {
          const res = await fetch(u, { headers: { Referer: embedUrl } });
          const s = await res.text();
          const mKey = s.match(/SOURCE_ENC_KEY\s*=\s*"([^"]+)"|SOURCE_ENC_KEY\s*=\s*'([^']+)'/);
          if (mKey) encKey = mKey[1] || mKey[2];
          const mIv = s.match(/SOURCE_ENC_IV\s*=\s*"([^"]+)"|SOURCE_ENC_IV\s*=\s*'([^']+)'/);
          if (mIv) encIv = mIv[1] || mIv[2];
          const mSec = s.match(/CDN_TOKEN_SECRET\s*=\s*"([^"]+)"|CDN_TOKEN_SECRET\s*=\s*'([^']+)'/);
          if (mSec) tokenSecret = mSec[1] || mSec[2];
        } catch (_) {}
      }
    }

    let data = null;
    for (const path of ["stream/getSourcesNew", "stream/getSources"]) {
      try {
        const sRes = await fetch(origin + "/" + path + "?id=" + fileId + "&id=" + fileId, {
          headers: {
            Referer: embedUrl,
            "X-Requested-With": "XMLHttpRequest"
          }
        });
        const json = await sRes.json();
        if (json && (json.enc || json.sources)) {
          data = json;
          break;
        }
      } catch (_) {}
    }

    if (!data || !data.enc) {
      throw new Error("MegaPlay returned no source data");
    }

    // 1. Decrypt AES-256-CBC using Hanami's native Crypto bridge
    const encB64 = base64urlToBase64(data.enc);
    const decryptedStr = await hanami.crypto.aesDecryptCbc(encB64, encKey, encIv);
    if (!decryptedStr) {
      throw new Error("MegaPlay native AES-CBC decryption returned empty");
    }

    const decryptedObj = JSON.parse(decryptedStr);
    let masterUrl = decryptedObj?.file || decryptedObj?.url ||
      (Array.isArray(decryptedObj?.sources) ? decryptedObj.sources[0]?.file : decryptedObj?.sources?.file);

    // 2. Token signing using native HMAC-SHA256 and Base64Url
    if (masterUrl) {
      const pathMatch = String(masterUrl).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
      if (pathMatch) {
        const pathKey = (pathMatch[1] + "/" + pathMatch[2]).toLowerCase();
        const expires = Math.floor(Date.now() / 1000) + 90;
        const payload = expires + "|" + pathKey;
        const signature = await hanami.crypto.hmacSha256(payload, tokenSecret, "base64url");
        const encodedPayload = await hanami.crypto.base64UrlEncode(payload);
        const token = encodedPayload + "." + signature;
        const sep = masterUrl.includes("?") ? "&" : "?";
        masterUrl = masterUrl + sep + "token=" + encodeURIComponent(token) + "&t=" + (audio || "sub");
      }
    }

    const subtitles = [];
    if (Array.isArray(data.tracks)) {
      for (const t of data.tracks) {
        if (t.file && t.kind !== "thumbnails") {
          subtitles.push({
            url: t.file,
            label: t.label || "English",
            srclang: (t.label || "en").toLowerCase().slice(0, 2),
            default: Boolean(t.default),
            headers: { Referer: origin + "/" }
          });
        }
      }
    }

    return {
      masterUrl: masterUrl,
      subtitles: subtitles,
      intro: data.intro ? { start: data.intro.start || 0, end: data.intro.end || 0 } : null,
      outro: data.outro ? { start: data.outro.start || 0, end: data.outro.end || 0 } : null
    };
  }

  const GogoanimeExtension = {
    id: "gogoanime",
    name: "Gogoanime",
    version: "1.0.2",
    versionCode: 3,
    author: "Hanami Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Stream sub and dub anime with high availability.",

    async getEpisodes(meta) {
      const enTitle = meta.titles && meta.titles.english;
      const romTitle = meta.titles && meta.titles.romaji;
      const synonyms = (meta.titles && meta.titles.synonyms) || [];

      // Gogoanime uses English titles primarily
      const queries = [enTitle, romTitle, ...synonyms].filter(Boolean);
      const groupMap = new Map();

      for (const query of queries.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/?s=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const articles = [...html.matchAll(/<article\s+class="bs"[\s\S]*?<\/article>/gi)];
          for (const a of articles) {
            const content = a[0];
            const linkMatch = content.match(/<a\s+href="https:\/\/gogoanime\.or\.at\/anime\/([^"/]+)\/?"[^>]*title="([^"]*)"/i);
            if (!linkMatch) continue;
            const slug = linkMatch[1];
            const rawTitle = cleanTitle(linkMatch[2]);
            const isDub = slug.endsWith("-dub") || /\(dub\)/i.test(rawTitle) || /class="sb Dub"/i.test(content);
            const cleanT = rawTitle.replace(/\s*\((?:dub|sub)\)\s*$/i, "").trim();
            const baseSlug = slug.replace(/-(?:dub|sub)$/i, "");

            let g = groupMap.get(baseSlug);
            if (!g) {
              g = { baseSlug: baseSlug, name: cleanT, subSlug: null, dubSlug: null };
              groupMap.set(baseSlug, g);
            }
            if (isDub) {
              g.dubSlug = slug;
            } else {
              g.subSlug = slug;
            }
          }

          if (groupMap.size > 0) break;
        } catch (e) {
          console.warn("Gogoanime search error:", (e && e.message) || e);
        }
      }

      const candidates = Array.from(groupMap.values());
      for (const c of candidates) {
        c.score = scoreCandidate(c, enTitle, romTitle, synonyms);
      }
      candidates.sort((a, b) => b.score - a.score);

      const chosenGroup = candidates.length > 0 ? candidates[0] : null;
      let targetSubSlug = chosenGroup ? (chosenGroup.subSlug || chosenGroup.baseSlug) : null;
      let targetDubSlug = chosenGroup ? chosenGroup.dubSlug : null;

      if (!targetSubSlug && !targetDubSlug) {
        const fallback = (romTitle || enTitle || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        targetSubSlug = fallback;
      }

      const episodesMap = new Map();

      async function fetchEpisodesFromSlug(slug, isDub) {
        if (!slug) return false;
        try {
          const pageUrl = BASE + "/anime/" + slug + "/";
          const res = await fetch(pageUrl, { headers: HEADERS });
          if (!res.ok) return false;
          const html = await res.text();

          const liRegex = /<li[^>]*data-index="[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
          let liMatch;
          let count = 0;
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
            count++;
          }
          return count > 0;
        } catch (e) {
          console.warn("Gogoanime fetch episodes error for " + slug + ":", (e && e.message) || e);
          return false;
        }
      }

      const subOk = await fetchEpisodesFromSlug(targetSubSlug, false);
      if (targetDubSlug && targetDubSlug !== targetSubSlug) {
        await fetchEpisodesFromSlug(targetDubSlug, true);
      } else if (chosenGroup && chosenGroup.baseSlug && subOk) {
        // Probe dub if not explicitly in search results
        await fetchEpisodesFromSlug(chosenGroup.baseSlug + "-dub", true);
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

      // 1. Direct player iframe with player.php?m3u8=
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

      // 2. Extract player embed and mirror servers
      const embedUrls = [];
      const pembedMatch = html.match(/<div class="player-embed" id="pembed"><iframe src="([^"]+)"/i);
      if (pembedMatch) embedUrls.push(pembedMatch[1]);

      const mirrorMatches = [...html.matchAll(/<option value="([^"]+)"[^>]*>\s*([^<\s]+)/gi)];
      for (const m of mirrorMatches) {
        try {
          const b64 = m[1];
          let decoded = "";
          if (typeof atob === "function") {
            decoded = atob(b64);
          } else {
            decoded = base64urlToBase64(b64);
          }
          const srcMatch = decoded.match(/src="([^"]+)"/i);
          if (srcMatch && !embedUrls.includes(srcMatch[1])) {
            embedUrls.push(srcMatch[1]);
          }
        } catch (_) {}
      }

      // Also support legacy li.server
      const serverRegex = /<li[^>]*class="server"[^>]*data-video="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
      let sMatch;
      while ((sMatch = serverRegex.exec(html)) !== null) {
        let embed = sMatch[1];
        if (embed.startsWith("//")) embed = "https:" + embed;
        if (!embedUrls.includes(embed)) embedUrls.push(embed);
      }

      for (let i = 0; i < embedUrls.length; i++) {
        let embed = embedUrls[i];
        if (embed.startsWith("//")) embed = "https:" + embed;
        const serverName = "Server " + (i + 1);

        if (embed.includes("newplayer.php")) {
          try {
            const pRes = await fetch(embed, { headers: { "Referer": targetUrl } });
            const pHtml = await pRes.text();
            const innerMatch = pHtml.match(/<iframe[^>]+src=["']?([^"'\s>]+)/i);
            if (innerMatch && innerMatch[1]) {
              const innerSrc = innerMatch[1];
              if (innerSrc.includes("megaplay.buzz") && typeof hanami !== "undefined" && hanami.crypto) {
                try {
                  const details = await extractMegaPlay(innerSrc, audio);
                  if (details && details.masterUrl) {
                    streams.push({
                      url: details.masterUrl,
                      type: "hls",
                      server: "MegaPlay " + serverName,
                      quality: "1080p",
                      headers: { "Referer": "https://megaplay.buzz/" },
                      subtitles: details.subtitles,
                      intro: details.intro,
                      outro: details.outro
                    });
                  }
                } catch (e) {
                  console.warn("Gogoanime MegaPlay extraction error:", (e && e.message) || e);
                }
              }

              // Embed fallback
              streams.push({
                url: innerSrc,
                type: "embed",
                server: serverName + " (Embed)",
                headers: { "Referer": origin(innerSrc) + "/" }
              });
            }
          } catch (_) {
            streams.push({
              url: embed,
              type: "embed",
              server: serverName,
              headers: { "Referer": origin(targetUrl) + "/" }
            });
          }
        } else if (embed.includes("player.php?m3u8=")) {
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

      if (streams.length === 0) {
        streams.push({
          url: targetUrl,
          type: "embed",
          server: "Gogo Web",
          headers: { "Referer": BASE + "/" }
        });
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(GogoanimeExtension);
})();
