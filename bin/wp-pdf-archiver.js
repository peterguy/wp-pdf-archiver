#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_OUTPUT_DIR = process.cwd();
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_PRINT_CSS = path.resolve(__dirname, "..", "styles", "print.css");

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp(0);
    return;
  }

  if (options.urls.length === 0) {
    printHelp(1);
    return;
  }

  await archiveUrls(options.urls, options);
}

function parseArgs(argv) {
  const options = {
    urls: [],
    outputDir: DEFAULT_OUTPUT_DIR,
    cssPath: DEFAULT_PRINT_CSS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.urls.push(arg);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Timeout must be a positive number of milliseconds.");
  }

  if (!fs.existsSync(options.cssPath)) {
    throw new Error(`Print stylesheet not found: ${options.cssPath}`);
  }

  return options;
}

function printHelp(exitCode) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`
Usage:
  wp-pdf-archiver [options] <wordpress-post-url> [...]

Options:
  -o, --output-dir <dir>  Directory for generated PDFs. Default: current directory
  --css <file>            Print stylesheet to inject before export
  --timeout <ms>          Navigation timeout in milliseconds. Default: 45000
  -h, --help              Show this help message

Example:
  wp-pdf-archiver -o ./pdfs https://example.com/post-one https://example.com/post-two
`.trim());

  process.exitCode = exitCode;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

async function archivePost(page, url, options) {
  console.log(`Archiving ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.emulateMedia({ media: "print" });

  const metadata = await page.evaluate(({ sourceUrl }) => {
    const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;
    const ARTICLE_SELECTORS = [
      "#main > .entryBox[id^='post-']",
      ".entryBox[id^='post-']",
      "article.post",
      "article.type-post",
      "article",
      ".post",
      ".type-post",
      ".hentry",
      ".single-post main",
      "main",
      "#primary",
      "#content",
    ];
    const CONTENT_SELECTORS = [
      ".entry",
      ".entry-content",
      ".post-content",
      ".article-content",
      ".post-body",
      ".content",
      ".post-entry",
    ];
    const TITLE_SELECTORS = [
      ".title h1",
      ".title h2 a",
      ".title h2",
      "h1.entry-title",
      ".entry-title",
      ".post-title",
      "h1.post-title",
      "article h1",
      "main h1",
      "h1",
    ];
    const DATE_SELECTORS = [
      ".postmetadata time",
      ".entry-meta time",
      "time.entry-date",
      ".entry-date",
      "time.published",
      ".post-date",
      "article time",
      "time",
    ];
    const COMMENTS_SELECTORS = [
      ".CommentList",
      "#comments",
      ".comments-area",
      ".comments",
      "ol.comment-list",
      "ul.comment-list",
    ];
    const REMOVE_SELECTORS = [
      "script",
      "style",
      "noscript",
      "iframe",
      "nav",
      "header nav",
      "aside",
      "form.search-form",
      ".sidebar",
      ".widget",
      ".widgets",
      ".footer-widgets",
      ".site-footer",
      ".sharedaddy",
      ".jp-relatedposts",
      ".post-navigation",
      ".navigation",
      ".nav-links",
      ".breadcrumbs",
      ".breadcrumb",
      ".advertisement",
      ".ads",
      ".ad",
      "[id*='ad-']",
      "[class*=' ad-']",
      "[class^='ad-']",
      ".code-block",
      ".share-links",
      ".social-share",
      ".yarpp",
      ".related-posts",
      ".newsletter",
      ".author-box",
      ".comment-respond",
      ".reply a.comment-reply-link",
      ".screen-reader-text",
      ".sr-only",
    ];

    const absoluteUrl = new URL(sourceUrl, document.location.href).href;

    function firstMatch(selectors, root = document) {
      for (const selector of selectors) {
        const found = root.querySelector(selector);
        if (found) {
          return found;
        }
      }
      return null;
    }

    function cloneNode(node) {
      return node ? node.cloneNode(true) : null;
    }

    function removeNoise(root) {
      if (!root) {
        return;
      }

      for (const selector of REMOVE_SELECTORS) {
        root.querySelectorAll(selector).forEach((node) => node.remove());
      }
    }

    function cleanAttributes(root) {
      if (!root) {
        return;
      }

      root.querySelectorAll("*").forEach((node) => {
        const keepOpen = node.tagName === "DETAILS" && node.hasAttribute("open");
        for (const attribute of [...node.attributes]) {
          if (
            attribute.name === "class" ||
            attribute.name === "id" ||
            attribute.name === "href" ||
            attribute.name === "src" ||
            attribute.name === "srcset" ||
            attribute.name === "alt" ||
            attribute.name === "title" ||
            attribute.name === "datetime" ||
            attribute.name === "cite" ||
            attribute.name === "open" ||
            attribute.name === "width" ||
            attribute.name === "height" ||
            attribute.name === "rel" ||
            attribute.name.startsWith("data-wp-pdf-")
          ) {
            continue;
          }
          node.removeAttribute(attribute.name);
        }
        if (keepOpen) {
          node.setAttribute("open", "");
        }
      });
    }

    function rewriteRelativeUrls(root) {
      if (!root) {
        return;
      }

      root.querySelectorAll("[href]").forEach((node) => {
        try {
          node.setAttribute("href", new URL(node.getAttribute("href"), absoluteUrl).href);
        } catch (_) {}
      });

      root.querySelectorAll("[src]").forEach((node) => {
        try {
          const resolvedUrl = new URL(node.getAttribute("src"), absoluteUrl);
          if (resolvedUrl.protocol === "http:") {
            resolvedUrl.protocol = "https:";
          }
          node.setAttribute("src", resolvedUrl.href);
        } catch (_) {}
      });

      root.querySelectorAll("img[srcset]").forEach((img) => {
        img.removeAttribute("srcset");
      });
    }

    function markInlineEmojis(root) {
      if (!root) {
        return;
      }

      root.querySelectorAll("img").forEach((img) => {
        const className = img.getAttribute("class") || "";
        const width = Number(img.getAttribute("width")) || img.width || 0;
        const height = Number(img.getAttribute("height")) || img.height || 0;
        const isEmojiClass = /\b(emoji|wp-smiley|smiley)\b/i.test(className);
        const isTinyImage = width > 0 && width <= 24 && height > 0 && height <= 24;

        if (isEmojiClass || isTinyImage) {
          img.setAttribute("data-wp-pdf-inline-emoji", "true");
        }
      });
    }

    function expandLinkedImages(root) {
      if (!root) {
        return;
      }

      root.querySelectorAll("a[href] img").forEach((img) => {
        if (img.hasAttribute("data-wp-pdf-inline-emoji")) {
          return;
        }

        const anchor = img.closest("a[href]");
        if (!anchor) {
          return;
        }

        const href = anchor.getAttribute("href") || "";
        let fullUrl = anchor.href || href;
        if (!IMAGE_EXTENSIONS.test(fullUrl)) {
          return;
        }

        try {
          const normalizedUrl = new URL(fullUrl, absoluteUrl);
          if (normalizedUrl.protocol === "http:") {
            normalizedUrl.protocol = "https:";
          }
          fullUrl = normalizedUrl.href;
        } catch (_) {}

        const clone = img.cloneNode(true);
        clone.setAttribute("src", fullUrl);
        clone.removeAttribute("srcset");
        clone.setAttribute("data-fullsize-replaced", "true");

        const picture = img.closest("picture");
        if (picture) {
          picture.replaceWith(clone);
          return;
        }

        img.replaceWith(clone);
      });
    }

    function promoteGalleryParagraphs(root) {
      if (!root) {
        return;
      }

      root.querySelectorAll("p").forEach((paragraph) => {
        const childElements = [...paragraph.children];
        if (childElements.length < 2) {
          return;
        }

        const imageLinks = childElements.filter((node) => {
          if (node.tagName === "A" && node.querySelector("img:not([data-wp-pdf-inline-emoji])")) {
            return true;
          }
          return node.tagName === "IMG" && !node.hasAttribute("data-wp-pdf-inline-emoji");
        });

        const textContent = paragraph.textContent.replace(/\s+/g, " ").trim();
        if (imageLinks.length < 2 || textContent.length > 40) {
          return;
        }

        const gallery = document.createElement("div");
        gallery.className = "wp-pdf-archiver-gallery";

        imageLinks.forEach((node) => {
          const img = node.tagName === "IMG" ? node : node.querySelector("img");
          if (!img) {
            return;
          }

          const figure = document.createElement("figure");
          figure.className = "wp-pdf-archiver-gallery__item";

          const imageClone = img.cloneNode(true);
          figure.append(imageClone);

          const captionText = img.getAttribute("alt") || img.getAttribute("title") || node.getAttribute?.("title") || "";
          if (captionText.trim()) {
            const figcaption = document.createElement("figcaption");
            figcaption.textContent = captionText.trim();
            figure.append(figcaption);
          }

          gallery.append(figure);
        });

        if (gallery.childElementCount > 0) {
          paragraph.replaceWith(gallery);
        }
      });
    }

    function forceOpenDetails(root) {
      if (!root) {
        return;
      }

      root.querySelectorAll("details").forEach((node) => {
        node.setAttribute("open", "");
      });
    }

    function extractArticleRoot() {
      for (const selector of ARTICLE_SELECTORS) {
        const candidates = [...document.querySelectorAll(selector)];
        if (candidates.length === 0) {
          continue;
        }

        candidates.sort((left, right) => right.innerText.length - left.innerText.length);
        return candidates[0];
      }

      return document.body;
    }

    function extractLegacyMetaDate(root) {
      const sibling = root?.nextElementSibling;
      if (!sibling) {
        return "";
      }

      const text = sibling.textContent.replace(/\s+/g, " ").trim();
      const match = text.match(/\bon\s+(.+?)\s+and\s+is\s+filed\s+under\b/i);
      return match ? match[1].trim() : "";
    }

    const articleRoot = extractArticleRoot();
    const contentRoot = firstMatch(CONTENT_SELECTORS, articleRoot) || articleRoot;
    const commentsRoot = firstMatch(COMMENTS_SELECTORS, document);
    const titleNode = firstMatch(TITLE_SELECTORS, articleRoot) || firstMatch(TITLE_SELECTORS, document);
    const dateNode = firstMatch(DATE_SELECTORS, articleRoot) || firstMatch(DATE_SELECTORS, document);

    const title = (titleNode?.textContent || document.title || sourceUrl).trim();
    const dateText = (dateNode?.textContent || extractLegacyMetaDate(articleRoot) || "").trim();
    const dateHtml = dateNode ? dateNode.outerHTML : "";

    const contentClone = cloneNode(contentRoot);
    const commentsClone = cloneNode(commentsRoot);

    [contentClone, commentsClone].forEach((root) => {
      removeNoise(root);
      markInlineEmojis(root);
      expandLinkedImages(root);
      promoteGalleryParagraphs(root);
      forceOpenDetails(root);
      rewriteRelativeUrls(root);
      cleanAttributes(root);
    });

    const wrapper = document.createElement("main");
    wrapper.className = "wp-pdf-archiver";
    wrapper.innerHTML = `
      <article class="wp-pdf-archiver__post">
        <header class="wp-pdf-archiver__header">
          <h1 class="wp-pdf-archiver__title"></h1>
          <div class="wp-pdf-archiver__date"></div>
          <div class="wp-pdf-archiver__source"><a href="${absoluteUrl}">${absoluteUrl}</a></div>
        </header>
        <section class="wp-pdf-archiver__content"></section>
        <section class="wp-pdf-archiver__comments">
          <h2>Comments</h2>
        </section>
      </article>
    `;

    const contentTarget = wrapper.querySelector(".wp-pdf-archiver__content");
    const commentsTarget = wrapper.querySelector(".wp-pdf-archiver__comments");
    const titleTarget = wrapper.querySelector(".wp-pdf-archiver__title");
    const dateTarget = wrapper.querySelector(".wp-pdf-archiver__date");

    titleTarget.textContent = title;
    if (dateHtml) {
      dateTarget.innerHTML = dateHtml;
    } else if (dateText) {
      dateTarget.textContent = dateText;
    } else {
      dateTarget.remove();
    }

    if (contentClone) {
      contentTarget.append(...contentClone.childNodes);
    }

    if (commentsClone) {
      commentsTarget.append(...commentsClone.childNodes);
    } else {
      commentsTarget.remove();
    }

    document.documentElement.setAttribute("data-wp-pdf-archiver", "true");
    document.title = title;
    document.body.innerHTML = "";
    document.body.append(wrapper);

    return {
      title,
      dateText,
      sourceUrl: absoluteUrl,
    };
  }, { sourceUrl: url });

  await page.addStyleTag({ path: options.cssPath });
  await page.evaluate(async () => {
    const imageNodes = [...document.images];
    await Promise.all(
      imageNodes.map((img) => {
        if (img.complete && img.naturalWidth > 0) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          setTimeout(done, 15000);
        });
      })
    );
  });

  const outputFile = path.join(
    options.outputDir,
    `${buildFileName(metadata.title, metadata.sourceUrl)}.pdf`
  );

  await page.pdf({
    path: outputFile,
    format: "A4",
    printBackground: true,
    margin: {
      top: "0.5in",
      right: "0.5in",
      bottom: "0.6in",
      left: "0.5in",
    },
    displayHeaderFooter: false,
  });

  console.log(`Saved ${outputFile}`);
}

async function archiveUrls(urls, options = {}) {
  const normalizedOptions = {
    outputDir: DEFAULT_OUTPUT_DIR,
    cssPath: DEFAULT_PRINT_CSS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...options,
  };

  ensureDirectory(normalizedOptions.outputDir);

  const browser = await chromium.launch({ headless: true });

  try {
    for (const url of urls) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 2200 },
      });

      try {
        page.setDefaultTimeout(normalizedOptions.timeoutMs);
        await archivePost(page, url, normalizedOptions);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

function buildFileName(title, sourceUrl) {
  const url = new URL(sourceUrl);
  const slugSource = title || url.pathname.split("/").filter(Boolean).pop() || url.hostname;
  const slug = slugSource
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return slug || "wordpress-post";
}

module.exports = {
  archiveUrls,
  buildFileName,
  parseArgs,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
