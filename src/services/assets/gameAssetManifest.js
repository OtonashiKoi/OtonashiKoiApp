"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const config = require("../../config");
const { attachCloudflareGameMedia } = require("./cloudflareGameMedia");
const hash = value => createHash("sha256").update(value).digest("hex");
const publicRoot = path.resolve(__dirname, "../../web/public");
const IMAGE = /\.(?:png|jpe?g|webp|gif|avif|svg)$/i;
const AUDIO = /\.(?:mp3|m4a|wav|ogg|aac)$/i;
const MEDIA_FIELDS = /^(?:imageUrl|imageThumbnailUrl|portraitUrl|portraitThumbnailUrl|backgroundUrl|background|cgUrl|bgm|sfx|url)$/;
const isCollection = item => /collect/i.test(String(item.itemType || "")) || /^【圖片】/.test(String(item.name || ""));
// Retained job-master definitions are not part of the currently available game.
const isUnreleasedJobMaster = doc => /^(?:npc-)?master-(?:swordsman|warrior|dwarf-warrior|rogue|mage|healer|archer|tactician|bard|barrier-mage|gambler)$/.test(String(doc.id || ""));

function mediaUrls(value, output = []) {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (MEDIA_FIELDS.test(key) && typeof child === "string" && /^(?:https?:\/\/|\/)/.test(child)) output.push(child);
    else if (child && typeof child === "object") mediaUrls(child, output);
  }
  return output;
}

function canonicalMedia(source, manifest, origin) {
  const plain = source.replace(/[?#].*$/, "");
  const aliases = manifest.itemArtAliases || {};
  const localPath = plain.replace(origin, "");
  const alias = aliases[source] || aliases[plain] || aliases[localPath];
  const url = new URL(alias || source, origin);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) return null;
  if (url.origin !== origin && !["res.cloudinary.com", "d8j0ntlcm91z4.cloudfront.net"].includes(url.hostname)) return null;
  if (url.origin === origin && /^\/(?:api|admin|auth)(?:\/|$)/.test(url.pathname)) return null;
  if (url.origin === origin && url.pathname.startsWith("/uploads/items/") && manifest.itemArtRevision) {
    url.searchParams.set("art", manifest.itemArtRevision);
  }
  if (!IMAGE.test(url.pathname) && !AUDIO.test(url.pathname)) return null;
  url.hash = "";
  return { url: url.origin === origin ? url.pathname + url.search : url.href, kind: AUDIO.test(url.pathname) ? "audio" : "image" };
}

async function buildCatalogAssets({ items, documents, manifest, origin, readLocal = async () => null }) {
  const excluded = new Set(items.filter(isCollection).flatMap(item => mediaUrls(item))
    .map(source => { try { return canonicalMedia(source, manifest, origin)?.url; } catch { return null; } }).filter(Boolean));
  const assets = new Map();
  const unavailable = new Set();
  for (const doc of [...items.filter(item => !isCollection(item)), ...documents.filter(doc => !isUnreleasedJobMaster(doc))]) {
    for (const source of mediaUrls(doc)) {
      let media;
      try { media = canonicalMedia(source, manifest, origin); } catch { continue; }
      if (!media || excluded.has(media.url) || assets.has(media.url)) continue;
      const local = media.url.startsWith("/") ? await readLocal(media.url) : null;
      if (local?.missing) { unavailable.add(media.url); continue; }
      assets.set(media.url, { ...media, bytes: local?.bytes || 0,
        revision: local?.revision || hash(media.url + ":" + String(doc.updatedAt || doc.createdAt || "catalog-v1")),
        integrity: Boolean(local), source: "catalog" });
    }
  }
  return { assets: [...assets.values()], excluded: [...excluded], unavailable: [...unavailable] };
}

let cached;
let pending;
async function getGameAssetManifest(serviceContext, { releasePath = path.join(publicRoot, ".app-current") } = {}) {
  const release = releasePath;
  const realRelease = await fs.realpath(release);
  if (cached?.release === realRelease && cached.expires > Date.now()) return cached.value;
  if (pending?.release === realRelease) return pending.promise;
  const promise = (async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(realRelease, "game-assets.json"), "utf8"));
    const db = await getMongoDb();
    const [items, monsters, pets, npcs, chapters, storyAssets] = await Promise.all([
      serviceContext.itemRepository.findAll(), serviceContext.monsterRepository.findAll(), serviceContext.petRepository.findAll(),
      serviceContext.storyRepository.listNpcs(), serviceContext.storyRepository.listChapters(), db.collection("storyAssets").find({}).toArray(),
    ]);
    const origin = new URL(config.api.publicBaseUrl || "https://otonashikoi.org").origin;
    const readLocal = async url => {
      const pathname = decodeURIComponent(new URL(url, origin).pathname);
      const localPath = pathname.startsWith("/static/") ? pathname.slice(7) : pathname;
      const file = path.resolve(publicRoot, "." + localPath);
      if (!file.startsWith(publicRoot + path.sep) || file.includes(`${path.sep}archive${path.sep}`)) return null;
      for (const candidate of [file, path.resolve(realRelease, "." + localPath)]) {
        try { const bytes = await fs.readFile(candidate); return { bytes: bytes.length, revision: hash(bytes) }; } catch { /* Try the active SPA release. */ }
      }
      return { missing: true };
    };
    const catalog = await buildCatalogAssets({ items, documents: [...monsters, ...pets, ...npcs, ...chapters, ...storyAssets], manifest, origin, readLocal });
    // Zone scenery is runtime content outside the SPA build.
    const zones = path.join(publicRoot, "uploads/zones");
    for (const name of await fs.readdir(zones).catch(() => [])) {
      if (!IMAGE.test(name)) continue;
      const url = `/uploads/zones/${name}`, local = await readLocal(url);
      if (local && !local.missing && !catalog.excluded.includes(url)) catalog.assets.push({ url, kind: "image", ...local, integrity: true, source: "catalog" });
    }
    const entries = new Map([...manifest.assets, ...catalog.assets].filter(asset => !catalog.excluded.includes(asset.url)).map(asset => [asset.url, asset]));
    const delivery = await attachCloudflareGameMedia([...entries.values()].sort((a, b) => a.url.localeCompare(b.url)));
    const assets = delivery.assets;
    const value = { version: hash(JSON.stringify(assets)), assets, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
      excludedCollections: true, workerRevision: manifest.workerRevision,
      ...(delivery.delivery ? { delivery: delivery.delivery, cdnOrigin: delivery.cdnOrigin } : {}),
      unavailableAssets: [...new Set([...catalog.unavailable, ...delivery.unavailable])] };
    cached = { release: realRelease, expires: Date.now() + 60_000, value };
    return value;
  })();
  pending = { release: realRelease, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}

module.exports = { getGameAssetManifest, buildCatalogAssets, canonicalMedia, isCollection };
