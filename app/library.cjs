const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_MANIFEST = 64 * 1024;
const DEFAULTS = Object.freeze({ petId: 'miso', size: 160, alwaysOnTop: true, motion: true, randomAnimations: true, followCursor: true, launchAtLogin: false, visible: true, position: null });
const BUILTIN = Object.freeze({ id: 'miso', displayName: 'Miso', description: 'Built-in cat.', builtin: true, spriteVersionNumber: 2 });
function normalizeSettings(input = {}) {
  return {
    petId: typeof input.petId === 'string' ? input.petId : DEFAULTS.petId,
    size: Number.isFinite(input.size) ? Math.max(48, Math.min(240, Math.round(input.size))) : DEFAULTS.size,
    ...Object.fromEntries(['alwaysOnTop', 'motion', 'randomAnimations', 'followCursor', 'launchAtLogin', 'visible'].map(k => [k, typeof input[k] === 'boolean' ? input[k] : DEFAULTS[k]])),
    position: input.position && Number.isFinite(input.position.x) && Number.isFinite(input.position.y) ? {x: Math.round(input.position.x), y: Math.round(input.position.y)} : null,
  };
}
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.includes(':') || value.startsWith('/') || value.split('/').some(p => p === '..' || p === '.')) throw new Error('The pet contains an unsafe file path.');
  return value;
}
function parseManifest(data) {
  if (data.length > MAX_MANIFEST) throw new Error('The pet.json file is too large.');
  let manifest;
  try { manifest = JSON.parse(data.toString('utf8')); } catch { throw new Error('pet.json is not valid JSON.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('pet.json must contain a pet object.');
  const spriteVersionNumber = manifest.spriteVersionNumber ?? 1;
  if (![1, 2].includes(spriteVersionNumber)) throw new Error('This pet uses an unsupported sprite version. Petex supports versions 1 and 2.');
  return { displayName: String(manifest.displayName || manifest.name || manifest.id || 'Imported pet').slice(0, 80), description: String(manifest.description || 'Imported from a Codex pet.').slice(0, 300), spriteVersionNumber, spritesheetPath: safeRelative(manifest.spritesheetPath || 'spritesheet.webp') };
}
async function validateSprite(bytes, version) {
  if (bytes.length > MAX_IMAGE) throw new Error('The sprite sheet must be smaller than 32 MB.');
  let size;
  try { size = await sharp(bytes, {limitInputPixels: 1536 * 2288}).metadata(); } catch { throw new Error('The sprite sheet is not a readable PNG or WebP image.'); }
  if (!['png', 'webp'].includes(size.format)) throw new Error('Use a PNG or WebP sprite sheet.');
  const rows = version === 2 ? 11 : 9;
  if (size.width !== 1536 || size.height !== rows * 208) throw new Error(`This pet needs a 1536 × ${rows * 208} sprite sheet (8 × ${rows} frames).`);
  if ((size.pages || 1) > 1) throw new Error('Use a static sprite atlas, not an animated image.');
  try { await sharp(bytes, {limitInputPixels: 1536 * 2288}).raw().toBuffer(); } catch { throw new Error('The sprite sheet is damaged and could not be decoded.'); }
  return size.format;
}
async function readBounded(file, limit) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error(`The selected file is too large or is not a regular file.`);
  return fs.readFile(file);
}
async function readFolder(manifestPath) {
  const root = await fs.realpath(path.dirname(manifestPath));
  const manifest = parseManifest(await readBounded(manifestPath, MAX_MANIFEST));
  const spritePath = await fs.realpath(path.join(root, manifest.spritesheetPath));
  const relative = path.relative(root, spritePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The sprite sheet must be inside the pet folder.');
  return { manifest, bytes: await readBounded(spritePath, MAX_IMAGE) };
}
async function readPackage(input) {
  const stat = await fs.stat(input);
  if (stat.isDirectory()) return readFolder(path.join(input, 'pet.json'));
  const ext = path.extname(input).toLowerCase();
  if (ext === '.json') return readFolder(input);
  if (ext === '.zip') {
    const zip = new AdmZip(await readBounded(input, MAX_IMAGE + 1024 * 1024));
    const entries = zip.getEntries().filter(e => !e.entryName.startsWith('__MACOSX/'));
    if (entries.length > 200) throw new Error('This archive contains too many files. Import one pet at a time.');
    for (const entry of entries) safeRelative(entry.entryName.replace(/\/$/, ''));
    const manifests = entries.filter(e => !e.isDirectory && path.posix.basename(e.entryName) === 'pet.json');
    if (manifests.length !== 1) throw new Error('The ZIP must contain exactly one pet.json file.');
    if (manifests[0].header.size > MAX_MANIFEST) throw new Error('The pet.json file is too large.');
    const manifest = parseManifest(manifests[0].getData());
    const spriteName = path.posix.join(path.posix.dirname(manifests[0].entryName), manifest.spritesheetPath);
    const matches = entries.filter(e => e.entryName === spriteName && !e.isDirectory);
    if (matches.length !== 1) throw new Error('The ZIP is missing its sprite sheet or contains duplicate files.');
    if (matches[0].header.size > MAX_IMAGE) throw new Error('The sprite sheet must be smaller than 32 MB.');
    return {manifest, bytes: matches[0].getData()};
  }
  if (['.png', '.webp'].includes(ext)) {
    const bytes = await readBounded(input, MAX_IMAGE);
    let size;
    try { size = await sharp(bytes, {limitInputPixels: 1536 * 2288}).metadata(); } catch { throw new Error('The selected image could not be read.'); }
    return {manifest: {displayName: path.basename(input, ext).replace(/[-_]/g, ' ').slice(0, 80), description: 'Imported sprite sheet.', spriteVersionNumber: size.height === 2288 ? 2 : 1}, bytes};
  }
  throw new Error('Choose a pet folder, pet.json, ZIP, or PNG / WebP sprite sheet.');
}
class Library {
  constructor(root) { this.root = root; this.petsPath = path.join(root, 'pets'); }
  async init() { await fs.mkdir(this.petsPath, {recursive: true}); }
  async settings() {
    try { return normalizeSettings(JSON.parse(await fs.readFile(path.join(this.root, 'settings.json'), 'utf8'))); } catch { return {...DEFAULTS}; }
  }
  async saveSettings(settings) {
    const file = path.join(this.root, 'settings.json');
    await fs.writeFile(`${file}.tmp`, JSON.stringify(normalizeSettings(settings), null, 2));
    await fs.rename(`${file}.tmp`, file);
  }
  async list() {
    const pets = [{...BUILTIN}];
    for (const entry of await fs.readdir(this.petsPath, {withFileTypes: true})) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.petsPath, entry.name, 'pet.json'), 'utf8'));
        const manifest = parseManifest(Buffer.from(JSON.stringify(data)));
        const sprite = await fs.realpath(path.join(this.petsPath, entry.name, manifest.spritesheetPath));
        const root = await fs.realpath(path.join(this.petsPath, entry.name));
        if (path.dirname(sprite) !== root) continue;
        pets.push({...manifest, id: entry.name, assetUrl: `pet-asset://library/${entry.name}/${manifest.spritesheetPath}`, fingerprint: data.fingerprint});
      } catch { /* A damaged entry must not prevent the rest of the library from loading. */ }
    }
    return pets;
  }
  async import(input) {
    const {manifest, bytes} = await readPackage(input);
    return this.importSprite(manifest, bytes);
  }
  async importSprite(manifest, bytes) {
    manifest = parseManifest(Buffer.from(JSON.stringify(manifest)));
    const ext = await validateSprite(bytes, manifest.spriteVersionNumber);
    const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = (await this.list()).find(p => p.fingerprint === fingerprint);
    if (existing) return {pet: existing, duplicate: true};
    const id = crypto.randomUUID();
    const folder = path.join(this.petsPath, id);
    const pet = {...manifest, id, spritesheetPath: `spritesheet.${ext}`, fingerprint};
    try {
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, pet.spritesheetPath), bytes);
      await fs.writeFile(path.join(folder, 'pet.json'), JSON.stringify(pet, null, 2));
    } catch (error) { await fs.rm(folder, {recursive: true, force: true}); throw error; }
    return {pet: {...pet, assetUrl: `pet-asset://library/${id}/${pet.spritesheetPath}`}, duplicate: false};
  }
  async remove(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('This pet cannot be removed.');
    await fs.rm(path.join(this.petsPath, id), {recursive: true, force: true});
  }
  async discover(codexHome) {
    const root = path.join(codexHome, 'pets');
    let entries;
    try { entries = await fs.readdir(root, {withFileTypes: true}); } catch { return []; }
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const file = path.join(root, entry.name, 'pet.json');
        const manifest = parseManifest(await readBounded(file, MAX_MANIFEST));
        candidates.push({...manifest, source: file});
      } catch { /* Non-pet folders are ignored. */ }
    }
    return candidates;
  }
}
module.exports = {Library, DEFAULTS, normalizeSettings, safeRelative, parseManifest, validateSprite, readPackage};
