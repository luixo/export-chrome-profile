import { lstat, mkdir, mkdtemp, open, rename, rm, rmdir, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Reader, TextWriter, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import { isProfileName, MANIFEST_NAME, type ProfileManifest } from "./chrome.js";

class FileReader extends Reader<FileHandle> {
  constructor(private readonly file: FileHandle, size: number) {
    super(file);
    this.size = size;
  }

  async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
    const data = new Uint8Array(Math.max(0, Math.min(length, this.size - offset)));
    for (let read = 0; read < data.length;) {
      const { bytesRead } = await this.file.read(data, read, data.length - read, offset + read);
      if (!bytesRead) throw new Error("Unexpected end of ZIP archive.");
      read += bytesRead;
    }
    return data;
  }
}

interface RestoreOptions {
  dryRun?: boolean;
  preview: (target: string, manifest?: ProfileManifest) => void;
  confirm: () => Promise<boolean>;
  password: () => Promise<string>;
}

async function requireAbsent(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  throw new Error(`Destination already exists: ${target}. Move it aside before restoring.`);
}

async function readManifest(entry?: FileEntry, password?: string): Promise<ProfileManifest | undefined> {
  if (!entry || (entry.encrypted && password === undefined)) return;
  if (entry.uncompressedSize > 16_384) throw new Error("Profile manifest is too large.");
  const manifest = JSON.parse(await entry.getData(new TextWriter(), { password, checkSignature: true }));
  if (typeof manifest?.sourceProfilePath !== "string" ||
      (manifest.browser !== undefined && typeof manifest.browser !== "string")) {
    throw new Error("Invalid profile manifest.");
  }
  return manifest;
}

export async function restoreProfile(archive: string, userDataDir: string, opts: RestoreOptions): Promise<string | undefined> {
  const file = await open(archive, "r");
  try {
    const reader = new ZipReader(new FileReader(file, (await file.stat()).size), { checkSignature: true });
    try {
      const contents: { entry: Entry; parts: string[] }[] = [];
      let profile: string | undefined;
      let manifest: FileEntry | undefined;
      const seen = new Set<string>();

      for (const entry of await reader.getEntries()) {
        const parts = entry.filename.replace(/\/$/, "").split("/");
        const [root, ...relative] = parts;
        const mode = (entry.unixMode ?? (entry.externalFileAttributes >>> 16)) & 0o170000;
        if (parts.some((part) => !part || /[. ]$|[\\:\x00-\x1f\x7f]/.test(part)) ||
            (mode && mode !== (entry.directory ? 0o040000 : 0o100000))) {
          throw new Error(`Unsafe ZIP entry: ${JSON.stringify(entry.filename)}.`);
        }
        const key = parts.join("/").normalize("NFC").toLowerCase();
        if (seen.has(key)) throw new Error(`Duplicate ZIP entry: ${JSON.stringify(entry.filename)}.`);
        seen.add(key);

        if (root === MANIFEST_NAME && relative.length === 0 && !entry.directory) {
          manifest = entry;
          continue;
        }
        if (!isProfileName(root) || (profile && profile !== root) ||
            (!entry.directory && relative.length === 0)) {
          throw new Error("Expected a ZIP containing exactly one Chromium profile.");
        }
        profile = root;
        if (relative.length) contents.push({ entry, parts: relative });
      }
      if (!profile || !contents.some(({ entry }) => !entry.directory)) {
        throw new Error("The ZIP does not contain any profile files.");
      }

      const target = join(userDataDir, profile);
      const encrypted = manifest?.encrypted || contents.some(({ entry }) => !entry.directory && entry.encrypted);
      opts.preview(target, await readManifest(manifest));
      if (opts.dryRun) return;
      await requireAbsent(target);
      if (!(await opts.confirm())) return;

      const password = encrypted ? await opts.password() : undefined;
      if (manifest?.encrypted) await readManifest(manifest, password);
      await mkdir(userDataDir, { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(join(userDataDir, ".restore-profile-"));
      try {
        for (const { entry, parts } of contents) {
          const path = join(staging, ...parts);
          if (entry.directory) {
            await mkdir(path, { recursive: true, mode: 0o700 });
            continue;
          }
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const output = await open(path, "wx", 0o600);
          try {
            await entry.getData(new WritableStream<Uint8Array>({
              write: (chunk) => output.writeFile(chunk),
            }), { password });
          } finally {
            await output.close();
          }
        }
        // Reserve the name exclusively before replacing our own empty directory.
        await mkdir(target, { mode: 0o700 });
        try {
          await rename(staging, target);
        } catch (err) {
          await rmdir(target).catch(() => undefined);
          throw err;
        }
        return target;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } finally {
      await reader.close();
    }
  } finally {
    await file.close();
  }
}
