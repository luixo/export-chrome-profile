# export-chrome-profile

Export your Chrome profile as a zip file — interactively and securely.

This tool is designed to help developers, AI agents, and browser automation engines (like Puppeteer/Playwright) securely move browser profiles between environments (e.g., from your local machine to a cloud sandbox).

![NPM Version](https://img.shields.io/npm/v/export-chrome-profile)
![License](https://img.shields.io/npm/l/export-chrome-profile)

## Quick Start

Run this fork from a local checkout:

```bash
npm ci
npm run dev
```

## Features

- **Zero Config**: Automatically discovers Chrome profiles (`Default`, `Profile 1`, etc.) on your machine.
- **Interactive Prompts**: Easily select which profile to export.
- **Selective Export**: Choose exactly what data to include (Cookies, History, Bookmarks, Extensions, Local Storage).
- **Auto-Optimization**: Automatically excludes massive regenerable cache directories (`GPUCache`, `Service Worker/CacheStorage`, etc.) to keep your zip file small. (e.g., A 300MB profile becomes an ~11MB zip).
- **Optional AES-256 encryption**: Choose password protection when exporting sensitive profile data.

## Usage

Running the command will launch an interactive wizard:

```text
  export-chrome-profile
  ─────────────────────────

✔ Which Chrome profile do you want to export? Default
✔ What data do you want to include in the export? Cookies, History, Bookmarks, Extensions, Local & Session Storage
✔ Do you want to secure the zip file with a password? Yes
✔ Enter the zip password: [hidden]
  Estimated final export size: ~11.4 MB

✔ Ready to proceed with export? Yes
✔ Success — 10.8 MB

  Saved to: /path/to/your/chrome-profile-2026-02-25T14-46-43.zip
  File is encrypted. Do not forget your password!
```

### Use a custom profile location

Pass `--user-data-dir` to open the same wizard for a different browser data directory:

```bash
npm run dev -- --user-data-dir "$HOME/Library/Application Support/Chromium"
```

Use the folder containing `Default` or `Profile 1`, not the profile folder itself. Without the flag, the tool uses Google Chrome's default location.

### Restore an exported ZIP

```bash
npm run dev -- restore ~/Downloads/chrome-profile.zip --user-data-dir "$HOME/Library/Application Support/Chromium" --dry-run
```

The preview shows where the profile will go without writing files. Omit `--dry-run` to restore. Quit the destination browser first, and move any existing `Default` or `Profile N` folder at the destination aside as a backup: restore will not overwrite it.

Both plain and password-protected ZIPs are supported, including earlier exports. Only restore archives you trust; they can contain browser extensions. New exports also record the original profile path inside the ZIP for reference. Restore never uses that path as the destination. It does not transfer Keychain data or `Local State`, so you may need to sign in again and select a restored numbered profile explicitly.

## Supported Platforms

- [x] **macOS** (`~/Library/Application Support/Google/Chrome/`)
- [ ] Windows (Coming soon)
- [ ] Linux (Coming soon)

## Privacy & Security

Browser profiles contain highly sensitive information including active session cookies, local storage tokens, and browsing history.

**This tool runs 100% locally.** No data is ever sent to any servers. The resulting `.zip` file is created directly on your machine. We strongly recommend using the built-in password encryption feature if you intend to move the resulting zip file across a network.

## License

MIT
