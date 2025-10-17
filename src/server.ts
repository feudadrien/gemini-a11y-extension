import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import puppeteer, { Page } from "puppeteer";
import axe from "axe-core";

/** Map friendly ruleset/level → axe tags (wcag22/21) */
function tagsFor(opts?: { ruleset?: "wcag22" | "wcag21"; level?: "A" | "AA" | "AAA"; extra?: string[] }) {
  const r = opts?.ruleset ?? "wcag22";
  const lvl = opts?.level ?? "AA";
  const base = [`${r.toLowerCase()}${lvl.toLowerCase()}`]; // e.g., wcag22aa
  return [...base, ...(opts?.extra ?? [])];
}

/** Extract WCAG SC ids from axe rule tags like `wcag143`, `wcag211` */
function wcagScFromTags(tags: string[]): string[] {
  return tags
    .filter(t => /^wcag\d{3}$/i.test(t))
    .map(t => t.replace(/^wcag/, "").split("").join(".").replace(/\.(\d)(\d)$/, ".$1.$2")); // "143" → "1.4.3"
}

/** Build canonical WCAG links (2.2 by default), plus Understanding/QuickRef */
function wcagLinks(sc: string, prefer: "wcag22" | "wcag21" = "wcag22") {
  const spec = prefer === "wcag22" ? "WCAG22" : "WCAG21";
  return {
    spec: `https://www.w3.org/TR/${spec}/`,
    quickref: `https://www.w3.org/WAI/${spec}/quickref/#${sc.replaceAll(".", "")}`,
    // Understanding pages are stable under /WAI/WCAG22/Understanding/, 2.1 uses WCAG21.
    understanding: `https://www.w3.org/WAI/${spec}/Understanding/`
  };
}

async function runAxeOnPage(page: Page, runOnlyTags?: string[]) {
  // Inject axe and run with optional tag filter (supported in axe.run runOnly) 
  // https://www.deque.com/axe/core-documentation/api-documentation/
  await page.addScriptTag({ content: axe.source });
  // @ts-ignore
  return await page.evaluate(async (tags) => {
    // @ts-ignore
    const options = tags?.length ? { runOnly: { type: "tag", values: tags } } : {};
    // @ts-ignore
    return await axe.run(document, options);
  }, runOnlyTags ?? []);
}

const server = new McpServer({ name: "a11y-axe", version: "0.1.0" });

const ScanArgs = z.object({
  url: z.string().url().optional(),
  html: z.string().optional(),
  ruleset: z.enum(["wcag22", "wcag21"]).optional(),
  level: z.enum(["A", "AA", "AAA"]).optional(),
  extraTags: z.array(z.string()).optional()
});

server.registerTool(
  "scan_url",
  { description: "Run axe-core on a URL", inputSchema: ScanArgs.pick({ url: true, ruleset: true, level: true, extraTags: true }).shape },
  async (args: z.infer<typeof ScanArgs>) => {
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(args.url!, { waitUntil: "networkidle2", timeout: 60000 });
      const results = await runAxeOnPage(page, tagsFor({ ruleset: args.ruleset, level: args.level, extra: args.extraTags }));
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    } finally { await browser.close(); }
  }
);

server.registerTool(
  "scan_html",
  { description: "Run axe-core on raw HTML", inputSchema: ScanArgs.pick({ html: true, ruleset: true, level: true, extraTags: true }).shape },
  async (args: z.infer<typeof ScanArgs>) => {
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(args.html!, { waitUntil: "domcontentloaded" });
      const results = await runAxeOnPage(page, tagsFor({ ruleset: args.ruleset, level: args.level, extra: args.extraTags }));
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    } finally { await browser.close(); }
  }
);

server.registerTool(
  "scan_batch",
  {
    description: "Run axe-core on multiple URLs",
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(1),
      ruleset: z.enum(["wcag22", "wcag21"]).optional(),
      level: z.enum(["A", "AA", "AAA"]).optional(),
      extraTags: z.array(z.string()).optional()
    }).shape
  },
  async (args: { urls: string[], ruleset?: "wcag22" | "wcag21", level?: "A" | "AA" | "AAA", extraTags?: string[] }) => {
    const browser = await puppeteer.launch({ headless: true });
    const out: any[] = [];
    try {
      for (const url of args.urls) {
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
          const results = await runAxeOnPage(page, tagsFor({ ruleset: args.ruleset, level: args.level, extra: args.extraTags }));
          out.push({ url, results });
        } catch (e: any) {
          out.push({ url, error: String(e) });
        } finally {
          await page.close();
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    } finally { await browser.close(); }
  }
);

await server.connect(new StdioServerTransport());