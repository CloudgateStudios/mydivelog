import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const requiredFiles = [
  "README.md",
  "CONTRIBUTING.md",
  ".gitignore",
  ".editorconfig",
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "docs/README.md",
  "docs/technology-decisions.md",
];

const errors = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    errors.push(`Missing required file: ${file}`);
  }
}

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

for (const file of trackedFiles) {
  if (file.endsWith(".DS_Store")) {
    errors.push(`Tracked macOS metadata file should be removed: ${file}`);
  }
}

const conflictPattern = /^(<<<<<<<|=======|>>>>>>>) /m;

for (const file of trackedFiles) {
  if (!/\.(md|json|ya?ml|ts|tsx|js|jsx|mjs|cjs|tf|sql|prisma|txt)$/.test(file)) {
    continue;
  }

  const content = execFileSync("git", ["show", `:${file}`], {
    encoding: "utf8",
  });

  if (conflictPattern.test(content)) {
    errors.push(`Merge conflict marker found in ${file}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Repo basics check passed.");
