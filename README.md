# wp-pdf-archiver

Small Node.js CLI for archiving individual WordPress posts to PDF with Playwright and Chromium.

The tool loads each post URL in a real browser, extracts the main post content and comments, removes common site chrome, expands linked gallery thumbnails to their full-size image when possible, injects a print stylesheet, and saves one PDF per post.

The repo also includes a companion CLI that discovers WordPress post URLs from a root URL.

## Requirements

- Node.js 18+
- Playwright Chromium installed

If Chromium is not installed yet:

```bash
npx playwright install chromium
```

## Install

```bash
npm install
```

## Usage

### Discover post URLs

Print discovered post URLs, one per line:

```bash
npx wp-post-url-scraper https://blog.streetpoet.org/
```

Print discovered post URLs as JSON:

```bash
npx wp-post-url-scraper --format json https://blog.streetpoet.org/
```

Force a specific discovery method:

```bash
npx wp-post-url-scraper --source sitemap https://blog.streetpoet.org/
```

Pipe discovered URLs into the PDF archiver:

```bash
npx wp-post-url-scraper https://blog.streetpoet.org/ | \
  xargs npx wp-pdf-archiver --output-dir ./pdfs
```

You can also run discovery through the package script:

```bash
npm run discover -- https://blog.streetpoet.org/
```

### Discover and archive from a root URL

Discover post URLs and archive them in one command:

```bash
npx wp-root-archiver --output-dir ./pdfs https://blog.streetpoet.org/
```

Preview the discovered URLs without generating PDFs:

```bash
npx wp-root-archiver --dry-run https://blog.streetpoet.org/
```

Archive just the first 10 discovered posts:

```bash
npx wp-root-archiver --limit 10 --output-dir ./pdfs https://blog.streetpoet.org/
```

You can also run the combined flow through the package script:

```bash
npm run archive-root -- --output-dir ./pdfs https://blog.streetpoet.org/
```

### Archive post URLs

Archive one post into the current directory:

```bash
npx wp-pdf-archiver https://example.com/2024/05/interesting-post/
```

Archive several posts into `./pdfs`:

```bash
npx wp-pdf-archiver \
  --output-dir ./pdfs \
  https://example.com/post-one/ \
  https://example.com/post-two/
```

Use a custom print stylesheet:

```bash
npx wp-pdf-archiver \
  --css ./styles/print.css \
  https://example.com/gallery-post/
```

Show help:

```bash
npx wp-pdf-archiver --help
```

You can also run it through the package script:

```bash
npm run archive -- https://example.com/post-one/
```

## What It Preserves

- Post title
- Published date when detected
- Main post body text
- Images inside the post body
- Comment threads and nested replies

## What It Removes

The CLI rebuilds the page as a print-focused document, which strips many common WordPress chrome elements:

- Navigation
- Sidebars
- Footer widget areas
- Related post blocks
- Social/share UI
- Common ad containers

## Gallery Handling

When the post contains an image thumbnail wrapped in a link to a full-size image file, the tool replaces the thumbnail source with the linked image before exporting the PDF. This helps preserve galleries that would otherwise print as small thumbnails.

## Notes

- WordPress themes vary, so selector heuristics are intentionally simple and inspectable.
- If a site uses unusual markup, update [`bin/wp-pdf-archiver.js`](/Users/peter/Documents/src/wp-pdf-archiver/bin/wp-pdf-archiver.js) selectors or override the CSS in [`styles/print.css`](/Users/peter/Documents/src/wp-pdf-archiver/styles/print.css).
- The generated filename is based on the detected post title.
- The URL scraper tries WordPress sitemaps first, then the REST posts endpoint, then the feed, then a light same-origin archive crawl.
