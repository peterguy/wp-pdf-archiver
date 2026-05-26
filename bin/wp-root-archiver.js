#!/usr/bin/env node

const path = require("path");
const { archiveUrls } = require("./wp-pdf-archiver");
const { discoverPostUrls } = require("./wp-post-url-scraper");

const DEFAULT_OUTPUT_DIR = process.cwd();

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

  const discovery = await discoverPostUrls(options.rootUrl, {
    source: options.source,
    includePages: options.includePages,
    verbose: options.verbose,
  });

  const urls = options.limit > 0 ? discovery.urls.slice(0, options.limit) : discovery.urls;

  if (urls.length === 0) {
    throw new Error(`No post URLs found for ${options.rootUrl}`);
  }

  console.log(`Discovered ${discovery.urls.length} URLs via ${discovery.source}`);
  if (options.limit > 0) {
    console.log(`Archiving first ${urls.length} URLs`);
  } else {
    console.log(`Archiving ${urls.length} URLs`);
  }

  if (options.dryRun) {
    process.stdout.write(`${urls.join("\n")}\n`);
    return;
  }

  await archiveUrls(urls, {
    outputDir: options.outputDir,
    cssPath: options.cssPath,
    timeoutMs: options.timeoutMs,
  });
}

function parseArgs(argv) {
  const options = {
    rootUrl: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    cssPath: path.resolve(__dirname, "..", "styles", "print.css"),
    timeoutMs: 45_000,
    source: "auto",
    includePages: false,
    dryRun: false,
    verbose: false,
    limit: 0,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-o" || arg === "--output-dir") {
      index += 1;
      if (!argv[index] || argv[index].startsWith("-")) {
        throw new Error(`${arg} requires a directory path.`);
      }
      options.outputDir = path.resolve(argv[index]);
      continue;
    }

    if (arg === "--css") {
      index += 1;
      if (!argv[index] || argv[index].startsWith("-")) {
        throw new Error("--css requires a file path.");
      }
      options.cssPath = path.resolve(argv[index]);
      continue;
    }

    if (arg === "--timeout") {
      index += 1;
      if (!argv[index] || argv[index].startsWith("-")) {
        throw new Error("--timeout requires a numeric value.");
      }
      options.timeoutMs = Number(argv[index]);
      continue;
    }

    if (arg === "--source") {
      index += 1;
      if (!argv[index] || argv[index].startsWith("-")) {
        throw new Error("--source requires a value.");
      }
      options.source = argv[index];
      continue;
    }

    if (arg === "--limit") {
      index += 1;
      if (!argv[index] || argv[index].startsWith("-")) {
        throw new Error("--limit requires a number.");
      }
      options.limit = Number(argv[index]);
      continue;
    }

    if (arg === "--include-pages") {
      options.includePages = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
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

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Timeout must be a positive number of milliseconds.");
  }

  if (!Number.isFinite(options.limit) || options.limit < 0) {
    throw new Error("Limit must be zero or a positive integer.");
  }

  return options;
}

function printHelp(exitCode) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`
Usage:
  wp-root-archiver [options] <wordpress-root-url>

Options:
  -o, --output-dir <dir>                  Directory for generated PDFs. Default: current directory
  --css <file>                            Print stylesheet to inject before export
  --timeout <ms>                          Navigation timeout in milliseconds. Default: 45000
  --source <auto|sitemap|rest|feed|crawl> Discovery source to use. Default: auto
  --limit <n>                             Archive only the first n discovered URLs
  --include-pages                         Include WordPress pages in discovery
  --dry-run                               Print discovered URLs without archiving
  --verbose                               Print discovery fallbacks to stderr
  -h, --help                              Show this help message

Examples:
  wp-root-archiver -o ./pdfs https://your.wordpress.blog/
  wp-root-archiver --limit 10 https://your.wordpress.blog/
  wp-root-archiver --dry-run https://your.wordpress.blog/
`.trim());

  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
