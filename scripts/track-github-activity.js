const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const USER = process.env.PROFILE_USER || "dgunarathna";
const STATE_PATH = path.join(__dirname, "../.github/github-activity-state.json");
const REPORT_TXT_PATH = path.join(__dirname, "../activity-report.txt");
const REPORT_HTML_PATH = path.join(__dirname, "../activity-report.html");

const EXCLUDED_USERS = (process.env.EXCLUDED_USERS || "dgunarathna,dhanushkacreately")
  .split(",")
  .map((username) => username.trim().toLowerCase())
  .filter(Boolean);

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  fs.appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
}

function isExcluded(login) {
  return EXCLUDED_USERS.includes(String(login).toLowerCase());
}

function filterExcluded(logins) {
  return logins.filter((login) => !isExcluded(login));
}

function ghApi(endpoint) {
  return execSync(`gh api "${endpoint}"`, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function fetchPaginated(endpoint, extractLogin) {
  const results = [];
  let page = 1;

  while (page <= 20) {
    try {
      const data = JSON.parse(ghApi(`${endpoint}?per_page=100&page=${page}`));
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      data.forEach((item) => {
        const login = extractLogin(item);
        if (login) {
          results.push(login);
        }
      });

      if (data.length < 100) {
        break;
      }
      page += 1;
    } catch (error) {
      console.warn(`Warning: failed ${endpoint} page ${page}: ${error.message}`);
      break;
    }
  }

  return filterExcluded([...new Set(results)]);
}

function getOwnedRepositories() {
  try {
    const output = ghApi(`users/${USER}/repos?per_page=100&type=owner&sort=updated`);
    const repos = JSON.parse(output);
    return repos.map((repo) => repo.full_name);
  } catch (error) {
    console.warn("Warning: could not list repositories.", error.message);
    return [];
  }
}

function fetchFollowers() {
  return fetchPaginated(`users/${USER}/followers`, (user) => user.login);
}

function fetchRepoLogins(repo, resource) {
  return fetchPaginated(`repos/${repo}/${resource}`, (user) => user.login);
}

function fetchForkOwners(repo) {
  return fetchPaginated(`repos/${repo}/forks`, (fork) => fork.owner?.login);
}

function fetchCurrentActivity(repos) {
  const stars = {};
  const watchers = {};
  const forks = {};

  repos.forEach((repo) => {
    stars[repo] = fetchRepoLogins(repo, "stargazers");
    watchers[repo] = fetchRepoLogins(repo, "subscribers");
    forks[repo] = fetchForkOwners(repo);
  });

  return {
    followers: fetchFollowers(),
    stars,
    watchers,
    forks,
  };
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    console.warn("Warning: could not parse activity state.", error.message);
    return null;
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function diffLists(previous = [], current = []) {
  const known = new Set(previous);
  return current.filter((login) => !known.has(login));
}

function diffRepoMap(previous = {}, current = {}) {
  const changes = {};

  Object.keys(current).forEach((repo) => {
    const newEntries = diffLists(previous[repo] || [], current[repo] || []);
    if (newEntries.length > 0) {
      changes[repo] = newEntries;
    }
  });

  return changes;
}

function formatUserLine(login) {
  return `@${login} — https://github.com/${login}`;
}

function buildReport(changes) {
  const lines = [
    "New GitHub Activity (silent — no notification sent to them)",
    "",
  ];
  const htmlParts = [
    "<div style=\"font-family:Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;\">",
    "<p><strong>New GitHub Activity</strong> (silent — no notification sent to them)</p>",
  ];

  if (changes.newFollowers.length > 0) {
    lines.push(`New follower${changes.newFollowers.length > 1 ? "s" : ""}:`);
    htmlParts.push(`<h3>New follower${changes.newFollowers.length > 1 ? "s" : ""}</h3><ul>`);
    changes.newFollowers.forEach((login) => {
      lines.push(`  ${formatUserLine(login)}`);
      htmlParts.push(`<li><a href="https://github.com/${login}">@${login}</a></li>`);
    });
    htmlParts.push("</ul>");
    lines.push("");
  }

  const appendRepoChanges = (title, repoChanges) => {
    Object.entries(repoChanges).forEach(([repo, logins]) => {
      lines.push(`${title} on ${repo}:`);
      htmlParts.push(`<h3>${title} on ${repo}</h3><ul>`);
      logins.forEach((login) => {
        lines.push(`  ${formatUserLine(login)}`);
        htmlParts.push(`<li><a href="https://github.com/${login}">@${login}</a></li>`);
      });
      htmlParts.push("</ul>");
      lines.push("");
    });
  };

  appendRepoChanges("New star", changes.newStars);
  appendRepoChanges("New watcher", changes.newWatchers);
  appendRepoChanges("New fork", changes.newForks);

  htmlParts.push("</div>");

  return {
    text: lines.join("\n"),
    html: htmlParts.join(""),
  };
}

function hasAnyChanges(changes) {
  return (
    changes.newFollowers.length > 0 ||
    Object.keys(changes.newStars).length > 0 ||
    Object.keys(changes.newWatchers).length > 0 ||
    Object.keys(changes.newForks).length > 0
  );
}

function listsChanged(previous, current) {
  return (
    JSON.stringify({
      followers: previous.followers,
      stars: previous.stars,
      watchers: previous.watchers,
      forks: previous.forks,
    }) !==
    JSON.stringify({
      followers: current.followers,
      stars: current.stars,
      watchers: current.watchers,
      forks: current.forks,
    })
  );
}

function main() {
  console.log(`Tracking GitHub activity for ${USER}`);
  console.log(`Excluded users: ${EXCLUDED_USERS.join(", ")}`);

  const repos = getOwnedRepositories();
  console.log(`Monitoring ${repos.length} repositories.`);

  const current = fetchCurrentActivity(repos);
  const previous = loadState();
  const needsBootstrap = !previous || previous.bootstrapped !== true;

  if (needsBootstrap) {
    const bootstrappedState = {
      bootstrapped: true,
      lastChecked: new Date().toISOString(),
      followers: current.followers,
      stars: current.stars,
      watchers: current.watchers,
      forks: current.forks,
    };

    saveState(bootstrappedState);
    console.log("Bootstrap complete. Activity baseline saved without sending alerts.");
    setOutput("has_changes", "false");
    setOutput("state_updated", "true");
    setOutput("bootstrapped", "true");
    return;
  }

  const changes = {
    newFollowers: diffLists(previous.followers, current.followers),
    newStars: diffRepoMap(previous.stars, current.stars),
    newWatchers: diffRepoMap(previous.watchers, current.watchers),
    newForks: diffRepoMap(previous.forks, current.forks),
  };

  const activityDetected = hasAnyChanges(changes);
  const shouldUpdateState = listsChanged(previous, current);

  if (activityDetected) {
    const report = buildReport(changes);
    fs.writeFileSync(REPORT_TXT_PATH, report.text, "utf8");
    fs.writeFileSync(REPORT_HTML_PATH, report.html, "utf8");
    console.log("New activity detected:");
    console.log(report.text);
  } else {
    console.log("No new activity detected.");
  }

  if (shouldUpdateState) {
    saveState({
      bootstrapped: true,
      lastChecked: new Date().toISOString(),
      followers: current.followers,
      stars: current.stars,
      watchers: current.watchers,
      forks: current.forks,
    });
  }

  setOutput("has_changes", activityDetected ? "true" : "false");
  setOutput("state_updated", shouldUpdateState ? "true" : "false");
  setOutput("bootstrapped", "false");
}

main();
