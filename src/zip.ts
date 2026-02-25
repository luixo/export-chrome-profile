import { createWriteStream } from "node:fs";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
// @ts-ignore
import archiver from "archiver";
// @ts-ignore
import archiverZipEncrypted from "archiver-zip-encrypted";
// @ts-ignore
import fastFolderSize from "fast-folder-size";
import { promisify } from "node:util";
import { EXCLUDED_DIRS, EXCLUDED_FILE_PATTERNS } from "./chrome.js";

const getFolderSize = promisify(fastFolderSize);

// Register the encrypted zip format
archiver.registerFormat("zip-encrypted", archiverZipEncrypted);

export interface ZipOptions {
  /** Source directory to zip */
  source: string;
  /** Output file path */
  output: string;
  /** Optional password for AES-256 encryption */
  password?: string;
  /** Array of specific categories to include */
  includes: string[];
  /** Progress callback — receives bytes processed so far */
  onProgress?: (bytesProcessed: number) => void;
}

/**
 * Determines if a file/folder should be included based on user selections
 * and default exclusionary rules (caches).
 */
export function shouldIncludeEntry(
  basePath: string,
  entryPath: string,
  includes: string[]
): boolean {
  // 1. Never include known cache directories
  for (const excluded of EXCLUDED_DIRS) {
    const prefix = `${basename(basePath)}/${excluded}`;
    if (entryPath.startsWith(prefix) || entryPath.startsWith(excluded)) {
      return false;
    }
  }

  // 2. Never include known regenerable files
  for (const pattern of EXCLUDED_FILE_PATTERNS) {
    const fileName = entryPath.split("/").pop() ?? "";
    if (fileName === pattern) {
      return false;
    }
  }

  // 3. Selective Inclusion Rules
  const rootItem = entryPath.split("/")[1] ?? entryPath; // e.g. "Cookies" or "Extensions"

  if (!includes.includes("cookies") && rootItem.startsWith("Cookies")) return false;
  if (!includes.includes("history") && rootItem.startsWith("History")) return false;
  if (!includes.includes("bookmarks") && rootItem.startsWith("Bookmarks")) return false;
  if (!includes.includes("extensions") && rootItem.startsWith("Extensions")) return false;
  
  if (!includes.includes("localstorage") && (
    rootItem.startsWith("Local Storage") || 
    rootItem.startsWith("Session Storage") ||
    rootItem.startsWith("IndexedDB")
  )) {
    return false;
  }

  return true;
}

/**
 * Zips the Chrome profile directory, applying selective inclusion filters,
 * cache exclusions, and optional password encryption.
 * Returns the final file size in bytes.
 */
export function zipDirectory(opts: ZipOptions): Promise<number> {
  const { source, output, password, includes, onProgress } = opts;

  return new Promise((resolve, reject) => {
    const outStream = createWriteStream(output);
    
    // Choose format and options based on encryption
    const format = (password ? "zip-encrypted" : "zip") as any;
    const archiveOpts: any = { zlib: { level: 5 } };
    
    if (password) {
      archiveOpts.encryptionMethod = "aes256";
      archiveOpts.password = password;
    }

    const archive = archiver(format, archiveOpts);

    outStream.on("close", () => resolve(archive.pointer()));
    archive.on("error", (err: any) => reject(err));

    if (onProgress) {
      archive.on("progress", (progress: any) => {
        onProgress(progress.fs.processedBytes);
      });
    }

    archive.pipe(outStream);

    archive.directory(source, basename(source), (entry: any) => {
      if (!shouldIncludeEntry(source, entry.name, includes)) {
        return false;
      }
      return entry;
    });

    archive.finalize();
  });
}

/**
 * Estimates the size of the directory by calculating the total size.
 * Note: This doesn't perfectly account for excluded files, but provides a good upper bound.
 */
export async function estimateSize(directoryPath: string): Promise<number> {
  try {
    const size = await getFolderSize(directoryPath);
    return size || 0;
  } catch {
    return 0;
  }
}

/**
 * Formats bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
