export interface ScrapeToolInput {
  url: string;
}

export interface ScrapedPage {
  title: string;
  content: string;
  url: string;
}

export interface ScrapeToolResult {
  pages: ScrapedPage[];
}

export async function scrapeTool(
  input: ScrapeToolInput,
): Promise<ScrapeToolResult> {
  const mainUrl = parseUrl(input.url);
  const mainPage = await fetchPage(mainUrl);
  const linkedPages = await fetchLinkedPages(mainUrl, mainPage.html);

  return {
    pages: [mainPage.page, ...linkedPages],
  };
}

interface FetchedPageResult {
  html: string;
  page: ScrapedPage;
}

async function fetchPage(url: string): Promise<FetchedPageResult> {
  let html: string;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Fetch failed with status ${response.status} ${response.statusText}.`,
      );
    }

    html = await response.text();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown fetch error.";
    throw new Error(`Unable to fetch "${url}": ${message}`);
  }

  return {
    html,
    page: {
      title: extractTitle(html),
      content: extractReadableText(html),
      url,
    },
  };
}

async function fetchLinkedPages(
  mainUrl: string,
  html: string,
): Promise<ScrapedPage[]> {
  const additionalLinks = extractSameDomainLinks(mainUrl, html).slice(0, 3);
  const pages: ScrapedPage[] = [];

  for (const link of additionalLinks) {
    try {
      const result = await fetchPage(link);
      pages.push(result.page);
    } catch {
      // Keep the scrape usable even if one linked page fails.
    }
  }

  return pages;
}

function parseUrl(value: string): string {
  try {
    const url = new URL(value);

    if (!["http:", "https:", "data:"].includes(url.protocol)) {
      throw new Error("Only http, https, and data URLs are supported.");
    }

    return url.toString();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid URL provided.";
    throw new Error(`Invalid URL: ${message}`);
  }
}

function extractSameDomainLinks(baseUrl: string, html: string): string[] {
  const base = new URL(baseUrl);

  if (!["http:", "https:"].includes(base.protocol)) {
    return [];
  }

  const links = new Set<string>();
  const hrefPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;

  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html)) !== null) {
    const rawHref = match[1].trim();

    if (!rawHref || rawHref.startsWith("#")) {
      continue;
    }

    try {
      const resolved = new URL(rawHref, base);

      if (!["http:", "https:"].includes(resolved.protocol)) {
        continue;
      }

      if (resolved.hostname !== base.hostname) {
        continue;
      }

      resolved.hash = "";
      links.add(resolved.toString());
    } catch {
      // Ignore malformed links extracted from the page.
    }
  }

  links.delete(base.toString());

  return [...links];
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) {
    return "";
  }

  return cleanText(match[1]);
}

function extractReadableText(html: string): string {
  // Remove content that is usually not useful for plain-text scraping.
  const withoutHiddenSections = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  // Preserve rough structure before stripping all remaining tags.
  const withBreaks = withoutHiddenSections
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|main|header|footer|li|ul|ol|h[1-6])>/gi,
      "\n",
    );

  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");

  return cleanText(withoutTags);
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    );
}
