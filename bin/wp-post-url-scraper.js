#!/usr/bin/env node

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp(0);
    return;
  }

  if (!options.rootUrl) {
    printHelp(1);
    return;
  }

  const rootUrl = normalizeRootUrl(options.rootUrl);
  const discoveryOrder = options.source === "auto"
    ? ["sitemap", "rest", "feed", "crawl"]
    : [options.source];

  const debug = [];

  for (const source of discoveryOrder) {
    try {
      const discovered = await discoverUrls(rootUrl, source, options);
      if (discovered.length > 0) {
        const urls = dedupeUrls(discovered).sort();
        writeOutput(urls, source, options);
        return;
      }

      debug.push(`${source}: no URLs found`);
    } catch (error) {
      debug.push(`${source}: ${error.message}`);
    }
  }

  if (options.verbose && debug.length > 0) {
    debug.forEach((line) => console.error(line));
  }

  throw new Error(`No post URLs found for ${rootUrl}`);
}

function parseArgs(argv) {
  const options = {
    rootUrl: "",
    source: "auto",
    format: "text",
    includePages: false,
    verbose: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--source") {
      index += 1;
      const value = argv[index];
      if (!value || value.startsWith("-")) {
        throw new Error("--source requires a value.");
      }

      if (!["auto", "sitemap", "rest", "feed", "crawl"].includes(value)) {
        throw new Error(`Unsupported source: ${value}`);
      }

      options.source = value;
      continue;
    }

    if (arg === "--format") {
      index += 1;
      const value = argv[index];
      if (!value || value.startsWith("-")) {
        throw new Error("--format requires a value.");
      }

      if (!["text", "json"].includes(value)) {
        throw new Error(`Unsupported format: ${value}`);
      }

      options.format = value;
      continue;
    }

    if (arg === "--include-pages") {
      options.includePages = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.rootUrl) {
      throw new Error("Only one root URL is supported at a time.");
    }

    options.rootUrl = arg;
  }

  return options;
}

function printHelp(exitCode) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`
Usage:
  wp-post-url-scraper [options] <wordpress-root-url>

Options:
  --source <auto|sitemap|rest|feed|crawl>  Discovery source to use. Default: auto
  --format <text|json>                     Output format. Default: text
  --include-pages                          Include WordPress pages when using sitemap discovery
  --verbose                                Print discovery failures and fallbacks to stderr
  -h, --help                               Show this help message

Examples:
  wp-post-url-scraper https://blog.streetpoet.org/
  wp-post-url-scraper --format json https://blog.streetpoet.org/
  wp-post-url-scraper --source rest https://blog.streetpoet.org/
`.trim());

  process.exitCode = exitCode;
}

function normalizeRootUrl(input) {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

async function discoverUrls(rootUrl, source, options) {
  if (source === "sitemap") {
    return discoverFromSitemap(rootUrl, options);
  }

  if (source === "rest") {
    return discoverFromRest(rootUrl, options);
  }

  if (source === "feed") {
    return discoverFromFeed(rootUrl);
  }

  if (source === "crawl") {
    return discoverFromCrawl(rootUrl);
  }

  throw new Error(`Unsupported source: ${source}`);
}

async function discoverFromSitemap(rootUrl, options) {
  const sitemapIndexUrl = new URL("wp-sitemap.xml", rootUrl).href;
  const sitemapIndex = await fetchText(sitemapIndexUrl);
  const sitemapPatterns = [/wp-sitemap-posts-post-\d+\.xml$/i];
  if (options.includePages) {
    sitemapPatterns.push(/wp-sitemap-posts-page-\d+\.xml$/i);
  }

  const sitemapUrls = extractXmlLocs(sitemapIndex).filter((url) =>
    sitemapPatterns.some((pattern) => pattern.test(url))
  );

  if (sitemapUrls.length === 0) {
    throw new Error("No post sitemap URLs found");
  }

  const discovered = [];
  for (const sitemapUrl of sitemapUrls) {
    const sitemapXml = await fetchText(sitemapUrl);
    discovered.push(...extractXmlLocs(sitemapXml));
  }

  return discovered;
}

async function discoverFromRest(rootUrl, options) {
  const contentTypes = [{ endpoint: "posts", field: "link" }];
  if (options.includePages) {
    contentTypes.push({ endpoint: "pages", field: "link" });
  }

  const urls = [];

  for (const contentType of contentTypes) {
    urls.push(...await discoverRestCollection(rootUrl, contentType.endpoint, contentType.field));
  }

  return urls;
}

async function discoverFromFeed(rootUrl) {
  const feedUrl = new URL("feed/", rootUrl).href;
  const feedXml = await fetchText(feedUrl);
  const itemLinks = [...feedXml.matchAll(/<item\b[\s\S]*?<link>([^<]+)<\/link>/gi)].map((match) =>
    decodeXmlEntities(match[1].trim())
  );

  if (itemLinks.length === 0) {
    throw new Error("No feed item links found");
  }

  return itemLinks;
}

async function discoverFromCrawl(rootUrl) {
  const queue = [rootUrl];
  const visited = new Set();
  const postUrls = new Set();
  const archiveHints = new Set([
    rootUrl,
    new URL("index.php/", rootUrl).href,
  ]);
  const root = new URL(rootUrl);

  while (queue.length > 0 && visited.size < 150) {
    const currentUrl = queue.shift();
    if (!currentUrl || visited.has(currentUrl)) {
      continue;
    }

    visited.add(currentUrl);

    let html = "";
    try {
      html = await fetchText(currentUrl);
    } catch (_) {
      continue;
    }

    const links = extractHtmlLinks(html, currentUrl).filter((link) =>
      isSameOrigin(root, link)
    );

    for (const link of links) {
      if (looksLikeWordPressPost(link)) {
        postUrls.add(stripTracking(link));
      }

      if (looksLikeArchivePage(link, rootUrl) && !visited.has(link) && !archiveHints.has(link)) {
        archiveHints.add(link);
        queue.push(link);
      }
    }
  }

  return [...postUrls];
}

function extractXmlLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) =>
    decodeXmlEntities(match[1].trim())
  );
}

function extractRestLinks(posts) {
  if (!Array.isArray(posts)) {
    return [];
  }

  return posts
    .map((post) => post && typeof post.link === "string" ? post.link : "")
    .filter(Boolean);
}

async function discoverRestCollection(rootUrl, endpointName, fieldName) {
  const apiRootCandidates = [
    new URL(`wp-json/wp/v2/${endpointName}?per_page=100&page=1&_fields=${fieldName}`, rootUrl).href,
    new URL(`index.php/wp-json/wp/v2/${endpointName}?per_page=100&page=1&_fields=${fieldName}`, rootUrl).href,
  ];

  let firstResponse = null;
  let candidateUrl = "";

  for (const candidate of apiRootCandidates) {
    try {
      firstResponse = await fetchJson(candidate);
      candidateUrl = candidate;
      break;
    } catch (_) {}
  }

  if (!firstResponse) {
    throw new Error(`REST ${endpointName} endpoint unavailable`);
  }

  const totalPages = Number(firstResponse.response.headers.get("x-wp-totalpages")) || 1;
  const urls = extractRestLinks(firstResponse.data);

  for (let page = 2; page <= totalPages; page += 1) {
    const pagedUrl = candidateUrl.replace("page=1", `page=${page}`);
    const response = await fetchJson(pagedUrl);
    urls.push(...extractRestLinks(response.data));
  }

  return urls;
}

function extractHtmlLinks(html, baseUrl) {
  return [...html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1/gi)]
    .map((match) => match[2])
    .map((href) => {
      try {
        return new URL(decodeXmlEntities(href), baseUrl).href;
      } catch (_) {
        return "";
      }
    })
    .filter(Boolean);
}

function looksLikeWordPressPost(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    return /\/(?:index\.php\/)?\d{4}\/\d{2}\/[^/]+\/?$/.test(path);
  } catch (_) {
    return false;
  }
}

function looksLikeArchivePage(url, rootUrl) {
  const normalized = stripTracking(url);
  if (normalized === rootUrl) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname;
    return (
      /\/(?:index\.php\/)?\d{4}\/\d{2}\/?$/.test(path) ||
      /\/(?:index\.php\/)?categories\//.test(path) ||
      /\/(?:index\.php\/)?page\/\d+\/?$/.test(path) ||
      /\/(?:index\.php\/)?$/.test(path)
    );
  } catch (_) {
    return false;
  }
}

function isSameOrigin(root, url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === root.origin;
  } catch (_) {
    return false;
  }
}

function stripTracking(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  return parsed.href;
}

function dedupeUrls(urls) {
  return [...new Set(urls.map(stripTracking))];
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "wp-post-url-scraper/1.0",
      accept: "text/html,application/xml,text/xml,application/rss+xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "wp-post-url-scraper/1.0",
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return {
    response,
    data: await response.json(),
  };
}

function writeOutput(urls, source, options) {
  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify({ source, count: urls.length, urls }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${urls.join("\n")}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
