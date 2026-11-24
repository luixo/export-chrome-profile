import { homedir } from "node:os";
import { join } from "node:path";
import { access, readdir } from "node:fs/promises";

/**
 * Directories inside the Chrome profile that are regenerated automatically
 * and don't contain meaningful user data. Excluding them shrinks the zip significantly.
 */
export const EXCLUDED_DIRS = [
  "Service Worker/CacheStorage",
  "Service Worker/ScriptCache",
  "GPUCache",
  "ShaderCache",
  "Code Cache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "BlobStorage",
  "Cache",
  "component_crx_cache",
];

/** File patterns to exclude (matched by name) */
export const EXCLUDED_FILE_PATTERNS = [
  "BrowserMetrics-spare.pma",
  "BrowserMetrics.pma",
];

/**
 * Returns the platform-specific path to Chrome's user-data directory.
 * Currently only supports macOS.
 */
export function getChromeDataDir(): string {
  const platform = process.platform;

  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }

  if (platform === "win32") {
    const appData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(appData, "Google", "Chrome", "User Data");
  }

  if (platform === "linux") {
    return join(homedir(), ".config", "google-chrome");
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Returns the full path to a specific Chrome profile directory.
 * @param profileName  Name of the profile folder (e.g. "Default", "Profile 1")
 */
export function getProfilePath(profileName = "Default", chromeDir = getChromeDataDir()): string {
  return join(chromeDir, profileName);
}

/**
 * Validates that the given path looks like a real Chrome profile.
 * It checks for the presence of characteristic files.
 */
export async function validateProfile(profilePath: string): Promise<boolean> {
  try {
    await access(profilePath);
  } catch {
    return false;
  }

  const entries = await readdir(profilePath);
  const markers = ["Preferences", "Cookies", "History", "Bookmarks"];

  return markers.some((m) => entries.includes(m));
}

/**
 * Lists all available Chrome profiles on this machine.
 */
export async function listProfiles(chromeDir = getChromeDataDir()): Promise<string[]> {
  try {
    const entries = await readdir(chromeDir, { withFileTypes: true });
    const profiles: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "Default" || entry.name.startsWith("Profile ")) {
        const isValid = await validateProfile(join(chromeDir, entry.name));
        if (isValid) profiles.push(entry.name);
      }
    }

    return profiles;
  } catch {
    return [];
  }
}
