import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { restoreProfile } from "../dist/restore.js";
import { zipDirectory } from "../dist/zip.js";

const options = { preview: () => {}, confirm: async () => true, password: async () => "test password" };

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), "restore-chrome-profile-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

for (const encrypted of [false, true]) {
  test(`restores a ${encrypted ? "password-protected" : "plain legacy"} export`, async (t) => {
    const dir = await workspace(t);
    const source = join(dir, "Original Browser", "Profile 1");
    const destination = join(dir, "Restored Browser");
    const archive = join(dir, "profile.zip");
    const history = Buffer.alloc(350_000, 0x61);
    await mkdir(join(source, "IndexedDB"), { recursive: true });
    await mkdir(join(source, "Empty Directory"));
    await writeFile(join(source, "IndexedDB", "site-data"), "site data");
    await writeFile(join(source, "History"), history);
    const manifest = { sourceProfilePath: source, browser: "Test Browser" };
    await zipDirectory({
      source, output: archive, includes: ["history", "localstorage"],
      ...(encrypted && { password: "test password", manifest }),
    });

    if (encrypted) {
      await assert.rejects(restoreProfile(archive, destination, {
        ...options, password: async () => "wrong password",
      }));
      await assert.rejects(lstat(join(destination, "Profile 1")), { code: "ENOENT" });
      assert.deepEqual(await readdir(destination).catch(() => []), []);
    }

    const target = await restoreProfile(archive, destination, options);
    assert.equal(target, join(destination, "Profile 1"));
    assert.deepEqual(await readFile(join(target, "History")), history);
    assert.equal(await readFile(join(target, "IndexedDB", "site-data"), "utf8"), "site data");
    assert.deepEqual(await readdir(join(target, "Empty Directory")), []);
    assert.deepEqual(await readdir(destination), ["Profile 1"]);
    await assert.rejects(restoreProfile(archive, destination, options), /Destination already exists/);
    assert.deepEqual(await readFile(join(target, "History")), history);
  });
}

test("CLI --dry-run reports both paths without creating the destination", async (t) => {
  const dir = await workspace(t);
  const source = join(dir, "Default");
  const archive = join(dir, "profile.zip");
  await mkdir(source);
  await writeFile(join(source, "History"), "history");
  await zipDirectory({
    source, output: archive, includes: ["history"], manifest: { sourceProfilePath: source },
  });

  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "restore", archive, "--user-data-dir", "New Data", "--dry-run"], {
    cwd: dir, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Restore destination: ${join(dir, "New Data", "Default")}`), result.stdout);
  assert.ok(result.stdout.includes(`Original profile: ${JSON.stringify(source)}`), result.stdout);
  await assert.rejects(lstat(join(dir, "New Data")), { code: "ENOENT" });
});

test("rejects invalid profile paths and symbolic links before writing", async (t) => {
  const dir = await workspace(t);
  const destination = join(dir, "browser");
  for (const [index, name, unixMode] of [[0, "Default/../outside"], [1, "Default/link", 0o120777]]) {
    const zip = new ZipWriter(new Uint8ArrayWriter());
    await zip.add(name, new TextReader("not profile data"), { unixMode });
    const archive = join(dir, `${index}.zip`);
    await writeFile(archive, await zip.close());
    await assert.rejects(restoreProfile(archive, destination, options), /Unsafe (ZIP entry|filename)/);
  }
  await assert.rejects(lstat(destination), { code: "ENOENT" });
});

test("cleans up staging when a legacy encrypted archive fails to decrypt", async (t) => {
  const dir = await workspace(t);
  const source = join(dir, "Default");
  const destination = join(dir, "browser");
  const archive = join(dir, "profile.zip");
  await mkdir(source);
  await writeFile(join(source, "History"), "history");
  await zipDirectory({ source, output: archive, includes: ["history"], password: "test password" });

  await assert.rejects(restoreProfile(archive, destination, {
    ...options, password: async () => "wrong password",
  }), /password/i);
  assert.deepEqual(await readdir(destination), []);
  assert.equal(await restoreProfile(archive, destination, options), join(destination, "Default"));
});
