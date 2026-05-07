const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const USER = process.env.PROFILE_USER || "dgunarathna";
const FEED_TYPE = process.env.PROFILE_FEED || "commits";
const README_PATH = path.join(__dirname, "../README.md");
const CONTRIBUTIONS_PATH = path.join(__dirname, "../CONTRIBUTIONS.md");

const EXCLUDED_REPOS = [
  "TestApp",
  "MadProject1",
  "todo-app",
  "todo",
  "Frontend",
  "Practical",
  "Programming-Assignment-Little-Lemon-Receipt-Maker",
  "dgweb",
  "dgunarathna"
];

const REPO_METADATA_OVERRIDES = {
  "ereamart": {
    description: "A professional-grade Inventory Management System (IMS) built with Spring Boot, Thymeleaf, and MySQL. Features real-time stock tracking, advanced reporting, and secure role-based access control.",
    homepageUrl: "https://ereamart.vercel.app"
  },
  "SketchAir": {
    description: "An innovative design-focused application showcasing advanced UI/UX principles and interactive web components.",
    homepageUrl: ""
  }
};

function parseRepositoryUrl(repositoryUrl) {
  if (!repositoryUrl) return "unknown/unknown";
  const parts = repositoryUrl.split("/repos/");
  return parts.length === 2 ? parts[1] : repositoryUrl.split("/repos/").pop();
}

function getOwnedRepositories() {
  try {
    const output = execSync(
      `gh repo list ${USER} --limit 1000 --json nameWithOwner,name,description,url,homepageUrl`,
      { stdio: ["ignore", "pipe", "pipe"] }
    ).toString();
    return JSON.parse(output);
  } catch (error) {
    console.warn("Warning: Could not list owned repositories.", error.message);
    return [];
  }
}

function getAllRecentCommits() {
  const allRepos = getOwnedRepositories();
  const repos = allRepos
    .filter((repo) => repo.nameWithOwner.toLowerCase() !== `${USER.toLowerCase()}/${USER.toLowerCase()}`)
    .map(repo => repo.nameWithOwner);
  const commits = [];
  const pageSize = 100;

  repos.forEach((repo) => {
    let page = 1;
    while (page <= 5) {
      try {
        const output = execSync(
          `gh api "repos/${repo}/commits?author=${USER}&per_page=${pageSize}&page=${page}"`,
          { stdio: ["ignore", "pipe", "pipe"] }
        ).toString();
        const repoCommits = JSON.parse(output);
        if (!Array.isArray(repoCommits) || repoCommits.length === 0) {
          break;
        }

        repoCommits.forEach((commit) => {
          commits.push({
            repo,
            sha: commit.sha,
            message: commit.commit.message.split("\n")[0],
            url: commit.html_url,
            date: commit.commit.author?.date || commit.commit.committer?.date,
            authorName: commit.commit.author?.name || commit.commit.committer?.name,
            authorEmail: commit.commit.author?.email || commit.commit.committer?.email,
          });
        });

        if (repoCommits.length < pageSize) {
          break;
        }

        page += 1;
      } catch (error) {
        console.warn(`Warning: Failed to fetch commits for ${repo}.`, error.message);
        break;
      }
    }
  });

  return commits;
}

function getAllRecentPrs() {
  try {
    const output = execSync(
      `gh search prs --author ${USER} --limit 1000 --sort updated --order desc --json title,url,state,closedAt,createdAt,repository,updatedAt`,
      { stdio: ["ignore", "pipe", "pipe"] }
    ).toString();
    const prs = JSON.parse(output);
    if (prs.length > 0) {
      return prs;
    }
  } catch (error) {
    console.warn("Warning: gh search prs failed, falling back to API search.", error.message);
  }

  try {
    const query = `author:${USER} is:pr`;
    const output = execSync(
      `gh api search/issues -f q='${query}' -f per_page=100 --jq '.items[] | {title,html_url,state,created_at,updated_at,closed_at,repository_url}'`,
      { stdio: ["ignore", "pipe", "pipe"] }
    ).toString();
    const items = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((item) => ({
        title: item.title,
        url: item.html_url,
        state: item.state,
        closedAt: item.closed_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        repository: {
          nameWithOwner: parseRepositoryUrl(item.repository_url),
        },
      }));
    return items;
  } catch (error) {
    console.warn("Warning: fallback API search failed.", error.message);
    return [];
  }
}

function parseContributionsFile() {
  try {
    if (!fs.existsSync(CONTRIBUTIONS_PATH)) {
      console.warn("Warning: CONTRIBUTIONS.md not found");
      return {};
    }

    const content = fs.readFileSync(CONTRIBUTIONS_PATH, "utf8");
    const contributions = {};

    // Parse the markdown file to extract contribution details
    const repoSections = content.split(/^## /m).slice(1); // Skip header

    repoSections.forEach((section) => {
      const lines = section.split("\n");
      const repoName = lines[0].trim();
      contributions[repoName] = [];

      let currentContribution = null;
      let currentField = null;

      lines.slice(1).forEach((line) => {
        if (line.startsWith("### ")) {
          if (currentContribution) {
            contributions[repoName].push(currentContribution);
          }
          currentContribution = {
            title: line.replace("### ", "").trim(),
            pr: "",
            date: "",
            techStack: "",
            implementation: [],
            impact: [],
          };
          currentField = null;
        } else if (currentContribution) {
          if (line.startsWith("- **PR:**")) {
            currentContribution.pr = line.replace("- **PR:**", "").trim();
          } else if (line.startsWith("- **Date:**")) {
            currentContribution.date = line.replace("- **Date:**", "").trim();
          } else if (line.startsWith("- **Status:**")) {
            currentContribution.status = line.replace("- **Status:**", "").trim();
          } else if (line.startsWith("- **Implementation:**")) {
            currentField = "implementation";
          } else if (line.startsWith("- **Impact:**")) {
            currentField = "impact";
          } else if (line.startsWith("  -") && currentField) {
            currentContribution[currentField].push(line.replace("  - ", "").trim());
          }
        }
      });

      if (currentContribution) {
        contributions[repoName].push(currentContribution);
      }
    });

    return contributions;
  } catch (error) {
    console.warn("Warning: Could not parse CONTRIBUTIONS.md:", error.message);
    return {};
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function extractRepoName(repoUrl) {
  return repoUrl.split("/").slice(-2).join("/");
}

function getStatusIndicator(pr) {
  const state = pr.state.toUpperCase();
  if (state === "MERGED") return "✅ Merged";
  if (state === "OPEN") return "🟡 Open";
  if (state === "CLOSED") return "❌ Closed";
  return pr.state;
}

function generateContributionsSection(prs, contributions) {
  if (prs.length === 0) {
    const hasContributionRegistry = Object.keys(contributions).length > 0;
    const emptyMessage = hasContributionRegistry
      ? "No live PRs were returned by GitHub search. This usually means the workflow token does not have access to all repositories."
      : "No recent contributions to display.";

    return `### ${formatDate(new Date())}

${emptyMessage}

`;
  }

  // Group PRs by repository
  const groupedByRepo = {};

  prs.forEach((pr) => {
    const repoNameWithOwner = pr.repository.nameWithOwner;
    // Removed filter to include all repos

    const repoName = extractRepoName(repoNameWithOwner);
    if (!groupedByRepo[repoName]) {
      groupedByRepo[repoName] = [];
    }
    groupedByRepo[repoName].push(pr);
  });

  // Calculate metrics
  const metrics = {
    total: prs.length,
    merged: prs.filter(pr => pr.state.toUpperCase() === "MERGED").length,
    open: prs.filter(pr => pr.state.toUpperCase() === "OPEN").length,
    closed: prs.filter(pr => pr.state.toUpperCase() === "CLOSED").length
  };

  let markdown = `| 📊 Total PRs | ✅ Merged | 🟡 Open | ❌ Closed |\n`;
  markdown += `| :---: | :---: | :---: | :---: |\n`;
  markdown += `| ${metrics.total} | ${metrics.merged} | ${metrics.open} | ${metrics.closed} |\n\n`;

  const sortedRepos = Object.keys(groupedByRepo).sort();

  sortedRepos.forEach((repo) => {
    const prList = groupedByRepo[repo];
    prList.sort((a, b) => new Date(b.updatedAt || b.closedAt) - new Date(a.updatedAt || a.closedAt));

    markdown += `### 📦 ${repo}\n\n`;
    markdown += `| Date | Contribution | Status | Implementation | Impact |\n`;
    markdown += `| :--- | :--- | :--- | :--- | :--- |\n`;

    prList.forEach((pr) => {
      const date = pr.createdAt;
      const month = formatDate(date);
      const status = getStatusIndicator(pr);
      const prLink = `[${pr.title}](${pr.url})`;

      // Try to find matching contribution details
      let implementation = "";
      let impact = "";
      let foundDetails = false;
      Object.entries(contributions).forEach(([contribRepo, contribList]) => {
        if (contribRepo.includes(repo.split("/")[1])) {
          contribList.forEach((contrib) => {
            if (
              contrib.title.toLowerCase().includes(pr.title.toLowerCase()) ||
              pr.title.toLowerCase().includes(contrib.title.toLowerCase())
            ) {
              if (contrib.implementation.length > 0) {
                contrib.implementation.forEach((item) => {
                  implementation += `• ${item}<br>`;
                });
              }

              if (contrib.impact.length > 0) {
                contrib.impact.forEach((item) => {
                  impact += `• ${item}<br>`;
                });
              }

              foundDetails = true;
            }
          });
        }
      });

      if (!foundDetails) {
        implementation = `• Feature development or bug fix addressing specific use cases`;
        impact = `• Improved reliability, performance, or user experience`;
      }

      // Clean up trailing <br>
      implementation = implementation.replace(/(<br>)+$/, "");
      impact = impact.replace(/(<br>)+$/, "");

      markdown += `| ${month} | ${prLink} | ${status} | ${implementation} | ${impact} |\n`;
    });

    markdown += "\n---\n\n";
  });

  return markdown;
}

function generateCommitContributionsSection(commits) {
  if (commits.length === 0) {
    return `### ${formatDate(new Date())}

No recent commits were returned by GitHub. This usually means the workflow token does not have access to all repositories or there are no commits matching the configured author.

`;
  }

  const commitsByRepo = commits.reduce((acc, commit) => {
    if (!acc[commit.repo]) acc[commit.repo] = [];
    acc[commit.repo].push(commit);
    return acc;
  }, {});

  const sortedRepos = Object.keys(commitsByRepo).sort();
  const totalCommits = commits.length;
  const totalRepos = sortedRepos.length;

  let markdown = `| 📊 Total commits | 📁 Repos |
`;
  markdown += `| :---: | :---: |
`;
  markdown += `| ${totalCommits} | ${totalRepos} |

`;

  sortedRepos.forEach((repo) => {
    const repoCommits = commitsByRepo[repo].sort((a, b) => new Date(b.date) - new Date(a.date));
    markdown += `### 📦 ${repo}

`;
    markdown += `| Date | Commit | Author |
`;
    markdown += `| :--- | :--- | :--- |
`;
    markdown += `| :--- | :--- | :--- |
`;

    repoCommits.forEach((commit) => {
      const date = formatDate(commit.date);
      const commitLink = `[${commit.message}](${commit.url})`;
      const authorLabel = commit.authorName || USER;
      markdown += `| ${date} | ${commitLink} | ${authorLabel} |
`;
    });

    markdown += `\n`;
  });

  return markdown;
}

function generateProductsSection(repos) {
  if (repos.length === 0) {
    return "No projects to display.";
  }

  const filteredRepos = repos.filter(
    (repo) => !EXCLUDED_REPOS.some(excluded => repo.name.toLowerCase() === excluded.toLowerCase())
  );

  if (filteredRepos.length === 0) {
    return "Coming soon...";
  }

  let markdown = `| 📁 Featured Products | 🌐 Live Demos |
`;
  markdown += `| :---: | :---: |
`;
  
  const liveDemosCount = filteredRepos.filter(r => r.homepageUrl || (REPO_METADATA_OVERRIDES[r.name]?.homepageUrl)).length;
  markdown += `| ${filteredRepos.length} | ${liveDemosCount} |

`;

  filteredRepos.forEach((repo) => {
    const name = repo.name;
    const override = REPO_METADATA_OVERRIDES[name] || {};
    
    const description = override.description || repo.description || "High-performance application focused on scalability and user experience.";
    const url = repo.url;
    const liveLink = override.homepageUrl || repo.homepageUrl;

    markdown += `### 📦 [${name}](${url})\n\n`;
    markdown += `> ${description}\n\n`;
    
    const links = [];
    links.push(`[Source Code](${url})`);
    if (liveLink) {
      links.push(`[Live Demo](${liveLink})`);
    }
    
    markdown += `${links.join(" | ")}\n\n`;
    markdown += `---\n\n`;
  });

  return markdown;
}

function updateReadme() {
  try {
    let readmeContent = fs.readFileSync(README_PATH, "utf8");
    const contributions = parseContributionsFile();
    let newContributions = "";
    let resultCount = 0;

    if (FEED_TYPE === "products") {
      const repos = getOwnedRepositories();
      newContributions = generateProductsSection(repos);
      resultCount = repos.length;
    } else if (FEED_TYPE === "prs") {
      const prs = getAllRecentPrs();
      newContributions = generatePrContributionsSection(prs, contributions);
      resultCount = prs.length;
    } else {
      const commits = getAllRecentCommits();
      newContributions = generateCommitContributionsSection(commits);
      resultCount = commits.length;
    }

    const startMarker = "<!-- AUTO-GENERATED SECTION START -->";
    const endMarker = "<!-- AUTO-GENERATED SECTION END -->";

    const startIndex = readmeContent.indexOf(startMarker);
    const endIndex = readmeContent.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
      console.error("Error: Could not find AUTO-GENERATED markers in README.md");
      process.exit(1);
    }

    const beforeSection = readmeContent.substring(0, startIndex + startMarker.length);
    const afterSection = readmeContent.substring(endIndex);

    const updatedContent = beforeSection + "\n" + newContributions + afterSection;

    fs.writeFileSync(README_PATH, updatedContent, "utf8");
    console.log("✅ README.md updated successfully!");
    console.log(`📊 Tracked ${resultCount} total contributions across repositories`);
  } catch (error) {
    console.error("Error updating README:", error.message);
    process.exit(1);
  }
}

updateReadme();