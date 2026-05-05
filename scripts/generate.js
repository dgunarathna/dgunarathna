const { execSync } = require("child_process");

const USER = "dgunarathna";

function getMergedPrs() {
  try {
    return JSON.parse(
      execSync(
        `gh search prs --author ${USER} --state closed --merged --limit 10 --json title,url,closedAt`,
        { stdio: ["ignore", "pipe", "pipe"] }
      ).toString()
    );
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : "";

    if (stderr) {
      console.error(stderr);
    }

    return [];
  }
}

const prs = getMergedPrs();

const output =
  prs.length > 0
    ? prs
        .map((pr) => {
          return `- ${pr.title}\n  → ${pr.url}`;
        })
        .join("\n\n")
    : "- No recent merged pull requests found yet.";

const section = `## 🚀 Recent Contributions\n\n${output}`;

console.log(section);