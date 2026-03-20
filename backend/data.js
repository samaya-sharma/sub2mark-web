const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9"
};

const normalizeUrl = (value) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;
};

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

let blogHtml = "";
let cachedUrl = "";

async function getBlogHtml(link) {
  const normalized = normalizeUrl(link);
  if (!normalized) {
    throw new Error("No post link provided. Please paste a Substack URL.");
  }
  if (blogHtml && cachedUrl === normalized) {
    return blogHtml;
  }
  const html = await fetchHtml(normalized);
  blogHtml = html;
  cachedUrl = normalized;
  return html;
}

export { getBlogHtml, blogHtml };
