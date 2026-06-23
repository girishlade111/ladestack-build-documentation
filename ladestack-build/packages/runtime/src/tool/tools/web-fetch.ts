import { z } from "zod";
import { ToolDefinition } from "../types.js";

function convertToMarkdown(html: string, url: string): string {
  let markdown = "";

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : "Untitled";
  markdown += `# ${title}\n\n`;
  markdown += `> Source: ${url}\n\n`;

  let text = html;

  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");

  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  text = text.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, "$1\n");
  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, "$1\n");

  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n\n");

  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, "![$2]($1)");
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, "![]($1)");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "---\n\n");

  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

  text = text.replace(/<[^>]*>/g, "");

  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^[ \t]+/gm, "");

  markdown += text.trim();

  if (markdown.length > 50000) {
    markdown = markdown.slice(0, 50000) + "\n\n... (content truncated at 50KB)";
  }

  return markdown;
}

export const webFetchTool: ToolDefinition = {
  name: "web-fetch",
  description: "Fetch and extract content from a URL. Returns the content converted to markdown format.",
  parameters: z.object({
    url: z.string().url("A valid URL is required"),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { url } = args as { url: string };

    const MAX_SIZE = 2 * 1024 * 1024;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,text/plain,application/json,*/*",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return {
          error: `HTTP ${response.status}: ${response.statusText}`,
          url,
          status: response.status,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);

      if (contentLength > MAX_SIZE) {
        return {
          error: `Content too large: ${contentLength} bytes (max ${MAX_SIZE})`,
          url,
          contentLength,
        };
      }

      const buffer = await response.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

      if (contentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(text);
          return {
            url,
            format: "json",
            content: JSON.stringify(parsed, null, 2),
            size: text.length,
          };
        } catch {
          return { url, format: "text", content: text.slice(0, 50000), size: text.length };
        }
      }

      if (contentType.includes("text/html")) {
        const markdown = convertToMarkdown(text, url);
        return { url, format: "markdown", content: markdown, size: markdown.length };
      }

      return {
        url,
        format: "text",
        content: text.slice(0, 50000),
        size: text.length,
      };
    } catch (error) {
      const err = error as Error;
      return {
        error: `Failed to fetch URL: ${err.message}`,
        url,
      };
    }
  },
};
