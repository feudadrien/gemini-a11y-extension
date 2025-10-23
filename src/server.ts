import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import puppeteer, { Page } from "puppeteer";
import axe from "axe-core";
import { readFile } from "fs/promises";

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
  console.log("Injecting axe-core...");
  await page.addScriptTag({ content: axe.source });
  console.log("Running axe-core scan...");
  // @ts-ignore
  const results = await page.evaluate(async (tags) => {
    // @ts-ignore
    const options = tags?.length ? { runOnly: { type: "tag", values: tags } } : {};
    // @ts-ignore
    return await axe.run(document, options);
  }, runOnlyTags ?? []);
  console.log("Scan complete.");
  return results;
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
    console.log(`Scanning URL: ${args.url}`);
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      console.log("Navigating to page...");
      await page.goto(args.url!, { waitUntil: "networkidle2", timeout: 60000 });
      console.log("Page loaded.");
      const results = await runAxeOnPage(page, tagsFor({ ruleset: args.ruleset, level: args.level, extra: args.extraTags }));
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    } finally { await browser.close(); }
  }
);

server.registerTool(
  "scan_html",
  { description: "Run axe-core on raw HTML", inputSchema: ScanArgs.pick({ html: true, ruleset: true, level: true, extraTags: true }).shape },
  async (args: z.infer<typeof ScanArgs>) => {
    console.log("Scanning HTML content...");
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      console.log("Loading HTML...");
      await page.setContent(args.html!, { waitUntil: "domcontentloaded", timeout: 60000 });
      console.log("HTML loaded.");
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
    console.log(`Scanning ${args.urls.length} URLs in batch...`);
    const browser = await puppeteer.launch({ headless: true });
    const out: any[] = [];
    try {
      for (const url of args.urls) {
        console.log(`Scanning URL: ${url}`);
        const page = await browser.newPage();
        try {
          console.log("Navigating to page...");
          await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
          console.log("Page loaded.");
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

server.registerTool(
  "scan_file",
  { description: "Run axe-core on a local HTML file", inputSchema: z.object({ path: z.string(), ruleset: z.enum(["wcag22", "wcag21"]).optional(), level: z.enum(["A", "AA", "AAA"]).optional(), extraTags: z.array(z.string()).optional() }).shape },
  async (args: { path: string, ruleset?: "wcag22" | "wcag21", level?: "A" | "AA" | "AAA", extraTags?: string[] }) => {
    console.log(`Scanning file: ${args.path}`);
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      console.log("Reading file...");
      const html = await readFile(args.path, "utf-8");
      console.log("Loading HTML...");
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
      console.log("HTML loaded.");
      const results = await runAxeOnPage(page, tagsFor({ ruleset: args.ruleset, level: args.level, extra: args.extraTags }));
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    } finally { await browser.close(); }
  }
);

const ScanWithLoginArgs = z.object({
  url: z.string().url(),
  loginUrl: z.string().url(),
  username: z.string(),
  password: z.string(),
  usernameSelector: z.string(),
  passwordSelector: z.string(),
  submitSelector: z.string(),
  ruleset: z.enum(["wcag22", "wcag21"]).optional(),
  level: z.enum(["A", "AA", "AAA"]).optional(),
  extraTags: z.array(z.string()).optional(),
});

server.registerTool(
  "scan_with_login",
  {
    description: "Run axe-core on a URL that requires login",
    inputSchema: ScanWithLoginArgs.shape,
  },
  async (args: z.infer<typeof ScanWithLoginArgs>) => {
    console.log(`Scanning URL with login: ${args.url}`);
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      
      console.log(`Navigating to login page: ${args.loginUrl}`);
      await page.goto(args.loginUrl, { waitUntil: "networkidle2", timeout: 60000 });
      console.log("Login page loaded.");

      console.log("Entering credentials...");
      await page.type(args.usernameSelector, args.username);
      await page.type(args.passwordSelector, args.password);
      
      console.log("Submitting login form...");
      await page.click(args.submitSelector);
      
      console.log("Waiting for navigation after login...");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
      console.log("Login successful.");

      console.log(`Navigating to target page: ${args.url}`);
      await page.goto(args.url, { waitUntil: "networkidle2", timeout: 60000 });
      console.log("Target page loaded.");
      
      const results = await runAxeOnPage(
        page,
        tagsFor({ ruleset: args.ruleset, level: args.level, extra: args.extraTags })
      );
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    } finally {
      await browser.close();
    }
  }
);

const SummarizeArgs = z.object({
  results: z.string(),
});

server.registerTool(
  "summarize_results",
  {
    description: "Summarize the results of an axe-core scan",
    inputSchema: SummarizeArgs.shape,
  },
  async (args: z.infer<typeof SummarizeArgs>) => {
    const results = JSON.parse(args.results);
    const violations = results.violations;
    const topIssues = violations.filter(
      (v: any) => v.impact === "critical" || v.impact === "serious"
    );

    let summary = `Found ${violations.length} total violations.\n\n`;
    summary += `**Top Issues (Critical and Serious):**\n`;
    if (topIssues.length > 0) {
      topIssues.forEach((issue: any) => {
        summary += `- **${issue.help}** (Impact: ${issue.impact})\n`;
        summary += `  - ${issue.description}\n`;
        summary += `  - WCAG: ${wcagScFromTags(issue.tags).join(", ")}\n`;
        summary += `  - Learn more: ${issue.helpUrl}\n`;
        summary += `  - Found in ${issue.nodes.length} element(s).\n`;
      });
    } else {
      summary += "No critical or serious issues found.\n";
    }

    return { content: [{ type: "text", text: summary }] };
  }
);

await server.connect(new StdioServerTransport());
