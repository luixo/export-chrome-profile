import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getProfilePath, listProfiles } from "../dist/chrome.js";

test("uses a custom user data directory for profile discovery and CLI diagnostics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "export-chrome-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const custom = join(root, "Browser Data");
  const profile = join(custom, "Profile 1");
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "Preferences"), "{}");

  assert.deepEqual(await listProfiles(custom), ["Profile 1"]);
  assert.equal(getProfilePath("Profile 1", custom), profile);

  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--user-data-dir", "Missing Data"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stdout.includes(`Looked in: ${join(root, "Missing Data")}`), result.stdout);
});
