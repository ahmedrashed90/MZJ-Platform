import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

const DAY_PATTERN = /^(0?[1-9]|[12]\d|3[01])-(0?[1-9]|1[0-2])$/;
const MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v"]);
const TYPE_FOLDERS = new Map([
  ["post", "post"], ["بوست", "post"],
  ["reel", "reel"], ["ريل", "reel"],
  ["story", "story"], ["ستوري", "story"],
]);

async function directories(path) {
  return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory());
}

async function optionalCaption(path) {
  for (const name of ["caption.txt", "Caption.txt", "الكابشن.txt"]) {
    try { return (await readFile(join(path, name), "utf8")).trim(); } catch {}
  }
  return "";
}

function numericOrder(name) {
  const match = name.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

export async function scanAgendaFolder(rootPath) {
  const rootStats = await stat(rootPath);
  if (!rootStats.isDirectory()) throw new Error("AGENDA_PATH_NOT_DIRECTORY");

  const jobs = [];
  for (const dayEntry of await directories(rootPath)) {
    if (!DAY_PATTERN.test(dayEntry.name)) continue;
    const dayPath = join(rootPath, dayEntry.name);
    for (const typeEntry of await directories(dayPath)) {
      const normalizedType = TYPE_FOLDERS.get(typeEntry.name.trim().toLowerCase());
      if (!normalizedType) continue;
      const typePath = join(dayPath, typeEntry.name);
      const caption = await optionalCaption(typePath);
      const files = (await readdir(typePath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .sort((a, b) => numericOrder(a.name) - numericOrder(b.name) || a.name.localeCompare(b.name, "ar"));

      if (!files.length) continue;
      jobs.push({
        sourceDay: dayEntry.name,
        postType: normalizedType,
        caption,
        media: files.map((entry, index) => ({
          localPath: join(typePath, entry.name),
          fileName: basename(entry.name),
          order: index + 1,
        })),
      });
    }
  }
  return jobs;
}
