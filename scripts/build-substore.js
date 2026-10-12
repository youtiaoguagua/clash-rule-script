const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "clash-script.js");
const targetPath = path.join(rootDir, "substore-script.js");

const source = fs.readFileSync(sourcePath, "utf8");

const adapter = `

// Sub-Store 文件脚本适配
const content = $content ?? $files[0];
const config = ProxyUtils.yaml.safeLoad(content);

$content = ProxyUtils.yaml.dump(main(config));
`;

const generated = `${source.trimEnd()}${adapter}`;
fs.writeFileSync(targetPath, generated, "utf8");
console.log(`Successfully generated ${path.relative(rootDir, targetPath)} from ${path.relative(rootDir, sourcePath)}`);
