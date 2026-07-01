import { execFileSync } from "node:child_process";

const [baseSha, headSha, prTitle] = process.argv.slice(2);

if (!baseSha || !headSha) {
  console.error("Usage: node scripts/check-conventional-commits.mjs <base-sha> <head-sha> [pr-title]");
  process.exit(1);
}

const allowedTypes = ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test"];

const conventionalCommitPattern = new RegExp(`^(${allowedTypes.join("|")})(\\([a-z0-9._-]+\\))?!?: .+`);

function isConventionalCommit(subject) {
  if (subject.startsWith("Revert ")) {
    return true;
  }

  return conventionalCommitPattern.test(subject);
}

const subjects = execFileSync("git", ["log", "--format=%s", `${baseSha}..${headSha}`], {
  encoding: "utf8",
})
  .split("\n")
  .map((subject) => subject.trim())
  .filter(Boolean)
  .filter((subject) => !subject.startsWith("Merge "));

const invalidSubjects = subjects.filter((subject) => !isConventionalCommit(subject));
const invalidPrTitle = prTitle && !isConventionalCommit(prTitle) ? prTitle : null;

if (invalidSubjects.length > 0 || invalidPrTitle) {
  console.error("PR title and commit subjects must follow Conventional Commits.");
  console.error("");
  console.error("Allowed examples:");
  console.error("- feat: add dive import workflow");
  console.error("- fix(api): handle duplicate dive numbers");
  console.error("- docs: update technology decisions");
  console.error("- chore!: change deployment layout");
  console.error("");

  if (invalidPrTitle) {
    console.error("Invalid PR title:");
    console.error(`- ${invalidPrTitle}`);
    console.error("");
  }

  if (invalidSubjects.length > 0) {
    console.error("Invalid commit subjects:");

    for (const subject of invalidSubjects) {
      console.error(`- ${subject}`);
    }
  }

  process.exit(1);
}

console.log("Conventional commit and PR title check passed.");
