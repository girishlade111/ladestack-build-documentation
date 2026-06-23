import { z } from "zod";
import { ToolDefinition } from "../types.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_PROVIDERS = {
  duckduckgo: async (query: string, numResults: number): Promise<SearchResult[]> => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) throw new Error(`Search provider returned ${response.status}`);

    const html = await response.text();
    const results: SearchResult[] = [];

    const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    let regMatch: RegExpExecArray | null;
    let count = 0;
    while ((regMatch = resultRegex.exec(html)) !== null && count < numResults) {
      const title = (regMatch[2] ?? "").replace(/<[^>]*>/g, "").trim();
      const snippet = (regMatch[3] ?? "").replace(/<[^>]*>/g, "").trim();
      let linkUrl = regMatch[1] ?? "";

      const redirectMatch = linkUrl.match(/uddg=([^&]+)/);
      if (redirectMatch && redirectMatch[1]) {
        linkUrl = decodeURIComponent(redirectMatch[1]);
      }

      if (title && snippet) {
        results.push({ title, url: linkUrl, snippet });
        count++;
      }
    }

    return results;
  },
};

export const webSearchTool: ToolDefinition = {
  name: "web-search",
  description: "Search the web for information. Returns search results with titles, URLs, and snippets.",
  parameters: z.object({
    query: z.string().min(1, "Search query is required"),
    numResults: z.number().int().min(1).max(20).optional().default(8),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { query, numResults } = args as { query: string; numResults?: number };
    const count = numResults ?? 8;

    try {
      const results = await SEARCH_PROVIDERS.duckduckgo(query, count);

      return {
        query,
        results,
        totalResults: results.length,
      };
    } catch (error) {
      return {
        query,
        error: `Search failed: ${(error as Error).message}`,
        results: [],
        totalResults: 0,
      };
    }
  },
};
