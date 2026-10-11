const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error("Usage: node scripts/prepare-integration-cache.cjs <cache-directory>");
  }

  const cache = path.resolve(directory);
  const source = fs.readFileSync(path.join(__dirname, "..", "clash-script.js"), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const providers = Object.values(context.createRuleProviders())
    .filter((provider) => provider.type === "http");

  for (const provider of providers) {
    const target = path.resolve(cache, provider.path);
    const relative = path.relative(cache, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Rule cache path escapes the target directory: " + provider.path);
    }
    if (new URL(provider.url).protocol !== "https:") {
      throw new Error("Rule download must use HTTPS: " + provider.url);
    }

    const response = await fetch(provider.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      throw new Error("HTTP " + response.status + ": " + provider.url);
    }
    const contents = Buffer.from(await response.arrayBuffer());
    if (provider.format === "mrs") {
      const zstdMagic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
      if (contents.length < 4 || !contents.subarray(0, 4).equals(zstdMagic)) {
        throw new Error("Invalid compressed MRS response: " + provider.url);
      }
    } else {
      const hasRules = contents.toString("utf8").split(/\r?\n/)
        .some((line) => /^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD),/.test(line));
      if (!hasRules) throw new Error("No domain rules in text response: " + provider.url);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    console.log(path.relative(cache, target) + " (" + contents.length + " bytes)");
  }
  console.log("Prepared " + providers.length + " remote rule sets in " + cache);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
