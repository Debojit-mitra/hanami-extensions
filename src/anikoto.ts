import CryptoJS from "crypto-js";

/**
 * Anikoto Extension for Hanami
 * Native direct HLS extraction with MegaPlay support and intelligent candidate scoring.
 */

const ANIKOTO = "https://anikototv.bz";
const HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Referer: ANIKOTO + "/",
};

function cleanTitle(str: string): string {
  return (str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function base64urlToBase64(str: string): string {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64;
}

function base64ToBase64url(str: string): string {
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function scoreCandidate(
  cand: { name: string; jp: string; slug: string },
  primaryEn?: string | null,
  primaryRom?: string | null,
  synonyms: string[] = []
): number {
  let score = 0;
  const candNameNorm = normalize(cand.name);
  const candJpNorm = normalize(cand.jp);
  const candSlugNorm = normalize(cand.slug);

  const normEn = normalize(primaryEn || "");
  const normRom = normalize(primaryRom || "");

  if (normEn && candNameNorm === normEn) score += 1000;
  if (normRom && candNameNorm === normRom) score += 900;
  if (normRom && candJpNorm === normRom) score += 800;

  const targetText = `${primaryEn || ""} ${primaryRom || ""} ${synonyms.join(" ")}`.toLowerCase();

  const modifiers = [
    "season 2",
    "season 3",
    "season 4",
    "season 5",
    "2nd season",
    "3rd season",
    "4th season",
    "5th season",
    "movie",
    "ova",
    "special",
    "specials",
  ];

  for (const mod of modifiers) {
    const modNorm = normalize(mod);
    const candHasMod = candNameNorm.includes(modNorm) || candSlugNorm.includes(modNorm);
    const targetHasMod = targetText.includes(mod);
    if (candHasMod && targetHasMod) score += 500;
    if (candHasMod && !targetHasMod) score -= 400;
    if (!candHasMod && targetHasMod) score -= 400;
  }

  for (const t of [primaryEn, primaryRom, ...synonyms]) {
    const normT = normalize(t || "");
    if (!normT || normT.length < 3) continue;
    if (candNameNorm.includes(normT) || normT.includes(candNameNorm)) score += 60;
    if (candJpNorm && candJpNorm.includes(normT)) score += 60;
  }

  return score;
}

/* ── MegaPlay Direct HLS Extractor ────────────────────────────────── */

async function extractMegaPlay(
  embedUrl: string,
  audio = "sub"
): Promise<{
  masterUrl: string | null;
  subtitles: { url: string; label: string; srclang: string; default: boolean; headers: Record<string, string> }[];
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
}> {
  const originMatch = embedUrl.match(/^(https?:\/\/[^/]+)/);
  const origin = originMatch ? originMatch[1] : "https://megaplay.buzz";

  const pageRes = await fetch(embedUrl, {
    headers: { Referer: "https://hianimes.re/" },
  });
  const pageHtml = await pageRes.text();
  const fileId = (pageHtml.match(/data-id=["']([^"']+)["']/i) || [])[1];
  if (!fileId) throw new Error("MegaPlay fileId not found");

  const scriptUrls: string[] = [];
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRegex.exec(pageHtml)) !== null) {
    const sUrl = sm[1].startsWith("http") ? sm[1] : `${origin}${sm[1].startsWith("/") ? "" : "/"}${sm[1]}`;
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

  let data: any = null;
  for (const path of ["stream/getSourcesNew", "stream/getSources"]) {
    try {
      const sRes = await fetch(`${origin}/${path}?id=${fileId}&id=${fileId}`, {
        headers: {
          Referer: embedUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
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

  const b64 = base64urlToBase64(data.enc);
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(b64),
  });

  let keyHex = "";
  for (let i = 0; i < 32; i++) {
    if (i < encKey.length) {
      const code = encKey.charCodeAt(i);
      keyHex += (code < 16 ? "0" : "") + code.toString(16);
    } else {
      keyHex += "00";
    }
  }
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.enc.Utf8.parse(encIv);

  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
  const decryptedObj = JSON.parse(decryptedStr);
  let masterUrl = decryptedObj?.file || decryptedObj?.url || decryptedObj?.sources?.file;

  if (masterUrl) {
    const pathMatch = String(masterUrl).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if (pathMatch) {
      const pathKey = `${pathMatch[1].toLowerCase()}/${pathMatch[2].toLowerCase()}`;
      const expires = Math.floor(Date.now() / 1000) + 90;
      const payload = `${expires}|${pathKey}`;
      const sig = CryptoJS.HmacSHA256(payload, tokenSecret);
      const signature = base64ToBase64url(CryptoJS.enc.Base64.stringify(sig));
      const token = `${base64ToBase64url(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(payload)))}.${signature}`;
      const sep = masterUrl.includes("?") ? "&" : "?";
      masterUrl = `${masterUrl}${sep}token=${encodeURIComponent(token)}&t=${audio}`;
    }
  }

  const subtitles: { url: string; label: string; srclang: string; default: boolean; headers: Record<string, string> }[] = [];
  if (Array.isArray(data.tracks)) {
    for (const t of data.tracks) {
      if (t.file && t.kind !== "thumbnails") {
        subtitles.push({
          url: t.file,
          label: t.label || "English",
          srclang: (t.label || "en").toLowerCase().slice(0, 2),
          default: Boolean(t.default),
          headers: { Referer: `${origin}/` },
        });
      }
    }
  }

  return {
    masterUrl,
    subtitles,
    intro: data.intro ? { start: data.intro.start || 0, end: data.intro.end || 0 } : null,
    outro: data.outro ? { start: data.outro.start || 0, end: data.outro.end || 0 } : null,
  };
}

/* ── Extension Definition ─────────────────────────────────────────── */

const AnikotoExtension = {
  id: "anikoto",
  name: "Anikoto",
  version: "1.0.6",
  versionCode: 7,
  author: "Hanami Community",
  audio: ["sub", "dub"],
  baseUrl: ANIKOTO,
  description: "Fast high-quality direct HLS video streams with soft subtitles from Anikoto.",

  async getEpisodes(meta: any) {
    console.log("[Anikoto] >>> getEpisodes started for:", JSON.stringify(meta.titles));
    const titles = [
      meta.titles && meta.titles.english,
      meta.titles && meta.titles.romaji,
      ...((meta.titles && meta.titles.synonyms) || []),
    ].filter(Boolean);

    let targetSlug: string | null = null;
    let candidates: { slug: string; name: string; jp: string; score: number }[] = [];

    // 1. Search candidate anime across title variants
    for (const query of titles.slice(0, 3)) {
      if (!query) continue;
      try {
        const searchUrl = ANIKOTO + "/filter?keyword=" + encodeURIComponent(query);
        console.log("[Anikoto] Searching keyword:", query, "url:", searchUrl);
        const res = await fetch(searchUrl, { headers: HEADERS });
        console.log("[Anikoto] Search response HTTP:", res.status);
        const html = await res.text();
        console.log("[Anikoto] Search response HTML length:", html.length);

        const linkRegex =
          /<a\s+class="name d-title"\s+href="(?:https?:\/\/[^"/]+)?\/watch\/([^"/]+)(?:\/ep-\d+)?"[^>]*data-jp="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(html)) !== null) {
          const cand = {
            slug: match[1],
            jp: match[2],
            name: cleanTitle(match[3]),
            score: scoreCandidate(
              { slug: match[1], jp: match[2], name: cleanTitle(match[3]) },
              meta.titles && meta.titles.english,
              meta.titles && meta.titles.romaji,
              meta.titles && meta.titles.synonyms
            ),
          };
          candidates.push(cand);
        }

        console.log("[Anikoto] Found candidates for", query, ":", candidates.length);
        if (candidates.length) break;
      } catch (e) {
        console.warn("[Anikoto] Search error:", (e as any).message);
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length > 0) {
      targetSlug = candidates[0].slug;
      console.log("[Anikoto] Best candidate chosen:", targetSlug, "score:", candidates[0].score);
    }

    if (!targetSlug) {
      const fallback = (meta.titles && (meta.titles.romaji || meta.titles.english)) || "";
      targetSlug = fallback
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      console.log("[Anikoto] Using fallback slug:", targetSlug);
    }

    // 2. Fetch anime watch page to get showId
    const episodes: any[] = [];
    try {
      const watchUrl = ANIKOTO + "/watch/" + targetSlug;
      console.log("[Anikoto] Fetching watchUrl:", watchUrl);
      const res = await fetch(watchUrl, { headers: HEADERS });
      console.log("[Anikoto] Watch page HTTP:", res.status);
      const html = await res.text();

      const showIdMatch = html.match(/data-id="(\d+)"/);
      const showId = showIdMatch ? showIdMatch[1] : null;
      console.log("[Anikoto] Extracted showId:", showId);

      if (showId) {
        const epListUrl = ANIKOTO + "/ajax/episode/list/" + showId;
        console.log("[Anikoto] Fetching episode list URL:", epListUrl);
        const listRes = await fetch(epListUrl, {
          headers: Object.assign({}, HEADERS, {
            "X-Requested-With": "XMLHttpRequest",
            Referer: watchUrl,
          }),
        });
        console.log("[Anikoto] Episode list HTTP:", listRes.status);
        const listData = await listRes.json();
        const listHtml = listData && listData.result ? listData.result : "";

        const epRegex = /<a\s+[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let epMatch: RegExpExecArray | null;
        while ((epMatch = epRegex.exec(listHtml)) !== null) {
          const tag = epMatch[0];
          const getAttr = function (name: string) {
            const m = tag.match(new RegExp("data-" + name + '="([^"]*)"'));
            return m ? m[1] : "";
          };

          const num = parseInt(getAttr("num"), 10);
          if (isNaN(num)) continue;

          const titleMatch = epMatch[2]
            ? epMatch[2].match(/<span\s+class="d-title"[^>]*>([\s\S]*?)<\/span>/i)
            : null;
          const title = titleMatch ? cleanTitle(titleMatch[1]) : "Episode " + num;

          episodes.push({
            number: num,
            title: title,
            ref: getAttr("ids") || getAttr("id") || String(num),
            sub: getAttr("sub") === "1",
            dub: getAttr("dub") === "1",
          });
        }
      }
    } catch (e) {
      console.warn("[Anikoto] Parse episodes error:", (e as any).message);
    }

    episodes.sort((a, b) => a.number - b.number);
    console.log("[Anikoto] Total parsed episodes:", episodes.length);
    return episodes;
  },

  async getStreams(episodeRef: string, audio: string) {
    console.log("[Anikoto] >>> getStreams started for ref:", episodeRef.slice(0, 30) + "...", "audio:", audio);
    const streams: any[] = [];
    let intro: any = null;
    let outro: any = null;

    try {
      const serverListUrl = ANIKOTO + "/ajax/server/list?servers=" + encodeURIComponent(episodeRef);
      const res = await fetch(serverListUrl, {
        headers: Object.assign({}, HEADERS, {
          "X-Requested-With": "XMLHttpRequest",
          Referer: ANIKOTO + "/",
        }),
      });
      const data = await res.json();
      const serverHtml = data && data.result ? data.result : "";
      console.log("[Anikoto] Server list HTML len:", serverHtml.length);

      const typeRegex = /<div\s+class="type"\s+data-type="([^"]+)">([\s\S]*?)<\/ul>\s*<\/div>/gi;
      let typeMatch: RegExpExecArray | null;
      const linkIds: { linkId: string; name: string }[] = [];
      while ((typeMatch = typeRegex.exec(serverHtml)) !== null) {
        const typeName = typeMatch[1];
        if (typeName !== audio && !(audio === "sub" && typeName === "hsub")) {
          continue;
        }

        const liRegex = /<li\s+[^>]*data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
        let liMatch: RegExpExecArray | null;
        while ((liMatch = liRegex.exec(typeMatch[2])) !== null) {
          linkIds.push({
            linkId: liMatch[1],
            name: cleanTitle(liMatch[2]) || "Server",
          });
        }
      }
      console.log("[Anikoto] Found matching server links for audio", audio, ":", linkIds.length);

      for (const s of linkIds) {
        try {
          console.log("[Anikoto] Resolving server:", s.name, "id:", s.linkId.slice(0, 25) + "...");
          const sRes = await fetch(ANIKOTO + "/ajax/server?get=" + encodeURIComponent(s.linkId), {
            headers: Object.assign({}, HEADERS, {
              "X-Requested-With": "XMLHttpRequest",
              Referer: ANIKOTO + "/",
            }),
          });
          const sData = await sRes.json();
          const embedUrl = sData && sData.result ? sData.result.url : null;
          console.log("[Anikoto] Embed URL:", embedUrl);

          if (embedUrl) {
            if (sData.result.skip_data) {
              if (!intro && Array.isArray(sData.result.skip_data.intro) && sData.result.skip_data.intro.length === 2) {
                intro = { start: sData.result.skip_data.intro[0], end: sData.result.skip_data.intro[1] };
              }
              if (!outro && Array.isArray(sData.result.skip_data.outro) && sData.result.skip_data.outro.length === 2) {
                outro = { start: sData.result.skip_data.outro[0], end: sData.result.skip_data.outro[1] };
              }
            }

            // Extract MegaPlay direct HLS
            if (/megaplay\.[^/]+\/stream\//i.test(embedUrl)) {
              try {
                const details = await extractMegaPlay(embedUrl, audio);
                if (details.masterUrl) {
                  streams.push({
                    url: details.masterUrl,
                    type: "hls",
                    server: s.name,
                    headers: { Referer: "https://megaplay.buzz/" },
                    subtitles: details.subtitles,
                  });
                  if (!intro && details.intro) intro = details.intro;
                  if (!outro && details.outro) outro = details.outro;
                }
              } catch (e) {
                console.warn("MegaPlay extraction failed:", (e as any).message);
              }
            } else if (embedUrl.includes(".m3u8")) {
              streams.push({
                url: embedUrl,
                type: "hls",
                server: s.name,
                headers: { Referer: ANIKOTO + "/" },
              });
            }
          }
        } catch (err) {
          console.warn("Server fetch error:", (err as any).message);
        }
      }
    } catch (e) {
      console.warn("Anikoto getStreams error:", (e as any).message);
    }

    return {
      streams: streams,
      intro: intro,
      outro: outro,
    };
  },
};

(globalThis as any).registerExtension(AnikotoExtension);
