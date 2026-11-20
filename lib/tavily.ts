import "server-only";

export type WebResult = { title: string; url: string; content: string };

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/** Web search via Tavily. Returns null if not configured or on failure. */
export async function tavilySearch(query: string): Promise<WebResult[] | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("Tavily error", res.status);
      return null;
    }
    const data = (await res.json()) as { results?: Partial<WebResult>[] };
    return (data.results ?? [])
      .filter((r) => r.url && r.title)
      .slice(0, 5)
      .map((r) => ({
        title: String(r.title),
        url: String(r.url),
        content: String(r.content ?? "").slice(0, 1500),
      }));
  } catch (e) {
    console.error("Tavily request failed", e);
    return null;
  }
}
