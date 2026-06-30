import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const markdownFiles = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === ".git" || entry === "node_modules") {
      continue;
    }

    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      walk(fullPath);
    } else if (entry.endsWith(".md")) {
      markdownFiles.push(fullPath);
    }
  }
}

walk(".");

const errors = [];
const markdownLinkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");

  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1].trim();
    const targetWithoutTitle = rawTarget.split(/\s+["'][^"']+["']$/)[0];
    const target = targetWithoutTitle.split("#")[0];

    if (
      target === "" ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:") ||
      target.startsWith("#")
    ) {
      continue;
    }

    const decodedTarget = decodeURIComponent(target);
    const resolved = path.resolve(path.dirname(file), decodedTarget);

    if (!existsSync(resolved)) {
      errors.push(`${file}: broken relative link -> ${rawTarget}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Markdown link check passed.");
