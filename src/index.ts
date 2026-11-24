#!/usr/bin/env node

import { resolve } from "node:path";
import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
// @ts-ignore
import { select, checkbox, confirm, password as passwordPrompt } from "@inquirer/prompts";
import { getChromeDataDir, getProfilePath, listProfiles } from "./chrome.js";
import { zipDirectory, formatBytes, estimateSize } from "./zip.js";

program
  .name("export-chrome-profile")
  .description("Export your Chrome profile interactively")
  .version("1.0.0")
  .option("--user-data-dir <path>", "Use a custom Chromium user data directory")
  .action(async ({ userDataDir }: { userDataDir?: string }) => {
    if (userDataDir === "") program.error("--user-data-dir must not be empty.");
    const chromeDataDir = resolve(userDataDir ?? getChromeDataDir());

    console.log("");
    console.log(chalk.bold("export-chrome-profile"));
    console.log(chalk.dim("─────────────────────────"));
    console.log("");

    // 1. Interactive Profile Selection
    const availableProfiles = await listProfiles(chromeDataDir);
    
    if (availableProfiles.length === 0) {
      console.log(chalk.red("  No valid Chrome profiles found on this machine."));
      console.log(chalk.dim(`  Looked in: ${chromeDataDir}`));
      process.exit(1);
    }

    let selectedProfile = availableProfiles[0];
    if (availableProfiles.length > 1) {
      selectedProfile = await select({
        message: "Which Chrome profile do you want to export?",
        choices: availableProfiles.map(p => ({ name: p === "Default" ? "Default Profile" : p, value: p }))
      });
    } else {
      console.log(chalk.dim(`  Auto-selected only available profile: ${selectedProfile}`));
    }

    const profilePath = getProfilePath(selectedProfile, chromeDataDir);

    // 2. Selective Export
    const inclusions = await checkbox({
      message: "What data do you want to include in the export?",
      choices: [
        { name: "Cookies", value: "cookies", checked: true },
        { name: "History (Browsing & Downloads)", value: "history", checked: true },
        { name: "Bookmarks", value: "bookmarks", checked: true },
        { name: "Extensions", value: "extensions", checked: true },
        { name: "Local & Session Storage", value: "localstorage", checked: true },
      ],
    });

    if (inclusions.length === 0) {
      console.log(chalk.yellow("  Warning: You selected nothing to export. Exiting."));
      process.exit(0);
    }

    // 3. Optional Encryption
    const wantsEncryption = await confirm({
      message: "Do you want to secure the zip file with a password?",
      default: false
    });

    let zipPassword;
    if (wantsEncryption) {
      zipPassword = await passwordPrompt({
        message: "Enter the zip password:",
        validate: (input: string) => input.length > 0 ? true : "Password cannot be empty"
      });
    }

    // 4. Size Estimation
    const calcSpinner = ora({ text: "Calculating export size...", indent: 2 }).start();
    const rawSize = await estimateSize(profilePath);
    // Rough heuristic: compression ratio is usually ~30-40% for typical Chrome data + we exclude caches
    const estimatedZipSize = rawSize * 0.15; 
    calcSpinner.stop();
    
    console.log(chalk.cyan(`  Estimated final export size: ~${formatBytes(estimatedZipSize)}`));
    console.log("");

    const proceed = await confirm({
      message: "Ready to proceed with export?",
      default: true
    });

    if (!proceed) {
      console.log(chalk.dim("  Export cancelled."));
      process.exit(0);
    }

    // 5. Output Location
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outputPath = resolve(process.cwd(), `chrome-profile-${timestamp}.zip`);

    // 6. Execution
    console.log("");
    const zipSpinner = ora({ text: "Exporting profile (this may take a moment)…", indent: 2 }).start();

    try {
      let lastUpdate = 0;
      const finalSize = await zipDirectory({
        source: profilePath,
        output: outputPath,
        password: zipPassword,
        includes: inclusions,
        onProgress: (bytes: number) => {
          const now = Date.now();
          if (now - lastUpdate > 500) {
            zipSpinner.text = `Exporting profile… ${formatBytes(bytes)} processed`;
            lastUpdate = now;
          }
        },
      });

      zipSpinner.succeed(`Success — ${chalk.bold(formatBytes(finalSize))}`);
      console.log("");
      console.log(chalk.green(`  ✅ Saved to: ${chalk.underline(outputPath)}`));
      
      if (zipPassword) {
         console.log(chalk.dim(`  🔒 File is encrypted. Do not forget your password!`));
      }
      console.log("");
    } catch (err: any) {
      zipSpinner.fail(chalk.red(`Export failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
