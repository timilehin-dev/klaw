/**
 * Tavily web search for agent research.
 * Requires TAVILY_API_KEY in the environment.
 */

export type TavilyResult = {
  success: boolean;
  summary: string;
  results?: Array<{ title: string; url: string; content: string }>;
  error?: string;
};

export async function tavilySearch(
  query: string,
  options: { maxResults?: number; searchDepth?: "basic" | "advanced" } = {}
): Promise<TavilyResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      summary: "",
      error: "Missing TAVILY_API_KEY",
    };
  }

  const maxResults = options.maxResults ?? 5;
  const searchDepth = options.searchDepth ?? "basic";

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        success: false,
        summary: "",
        error: `Tavily API ${response.status}: ${response.statusText} ${body}`,
      };
    }

    const data = await response.json();
    const results = (data.results || []).map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      content: (r.content || "").slice(0, 800),
    }));

    const lines: string[] = [];
    if (data.answer) {
      lines.push(`Answer: ${data.answer}`);
      lines.push("");
    }
    results.forEach((r: { title: string; url: string; content: string }, i: number) => {
      lines.push(`${i + 1}. ${r.title}`);
      lines.push(`   URL: ${r.url}`);
      if (r.content) lines.push(`   ${r.content}`);
    });

    return {
      success: true,
      summary: lines.join("\n") || "No results",
      results,
    };
  } catch (e: any) {
    return {
      success: false,
      summary: "",
      error: e?.message || "Tavily request failed",
    };
  }
}
