#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.xrouter/runtime so the first
// `xrouter` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
// `npx xrouter …` (npm_command=exec) is typically a one-shot `connect` — skip
// the runtime warm-up; cli.js self-heals it if the server is started later.
if (process.env.npm_command === "exec") process.exit(0);

const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[xrouter] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[xrouter] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[xrouter] tray runtime skipped: ${e.message}`);
}

// Clean, zero-emoji, animated developer installation banner
const isTTY = Boolean(process.stdout && process.stdout.isTTY);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderBanner() {
  const line = "--------------------------------------------------------";
  const brandOrange = "\x1b[38;2;229;106;74m";
  const boldWhite = "\x1b[1m\x1b[37m";
  const cyan = "\x1b[36m\x1b[1m";
  const amber = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";

  if (isTTY) {
    process.stdout.write("\n" + brandOrange + "  [>] Initializing X Router CLI environment..." + reset);
    const spinner = ["-", "\\", "|", "/"];
    for (let i = 0; i < 8; i++) {
      process.stdout.write("\r" + brandOrange + `  [${spinner[i % spinner.length]}] Initializing X Router CLI environment...` + reset);
      await sleep(60);
    }
    process.stdout.write("\r" + brandOrange + "  [OK] X Router CLI environment initialized.       \n" + reset);
  }

  console.log("\n" + brandOrange + line + reset);
  console.log(`  ${boldWhite}X ROUTER INSTALLED SUCCESSFULLY${reset}`);
  console.log(brandOrange + line + reset);
  console.log("\n  To start the server and open the web dashboard, run:");
  console.log(`     ${cyan}xrouter${reset}   ${dim}(or ${cyan}xrouter-ai${dim})${reset}`);
  console.log("\n  Available CLI commands:");
  console.log(`     ${amber}xrouter --port 8080${reset}      Start on custom port`);
  console.log(`     ${amber}xrouter --help${reset}           Show all available options`);
  console.log(`     ${amber}xrouter status${reset}           Check running instances`);
  console.log("\n  Documentation & Repository:");
  console.log(`     ${dim}https://github.com/johsua092-ui/x-router${reset}`);
  console.log(brandOrange + line + reset + "\n");
}

renderBanner().then(() => {
  process.exit(0);
}).catch(() => {
  process.exit(0);
});
