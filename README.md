# Gemini A11y Extension

An accessibility (a11y) extension for the Gemini CLI that uses axe-core to scan for accessibility issues.

## Installation

To install the extension, use the following command:

```bash
gemini extensions install feudadrien/gemini-a11y-extension
```

## Usage

The extension provides the following slash commands:

### `/a11y:scan`

Scans a URL or a string of HTML for accessibility issues.

**Examples:**

```bash
/a11y:scan https://example.com
```

```bash
/a11y:scan "<!DOCTYPE html><html><body><h1>Hello, World!</h1></body></html>"
```

### `/a11y:scan-file`

Scans a local HTML file for accessibility issues.

**Example:**

```bash
/a11y:scan-file /path/to/your/file.html
```

### `/a11y:batch`

Scans multiple URLs for accessibility issues.

**Example:**

```bash
/a11y:batch https://example.com, https://google.com
```

### `/a11y:report`

Generates a Markdown report from the last scan.

**Example:**

```bash
/a11y:report
```

## What it can do

*   **Scan for Accessibility Issues:** The extension can scan web pages and HTML content for accessibility issues using the axe-core engine.
*   **Multiple Scan Targets:** You can scan a single URL, a string of HTML, a local HTML file, or a batch of multiple URLs.
*   **WCAG Compliance Levels:** You can specify the Web Content Accessibility Guidelines (WCAG) conformance level to test against (A, AA, or AAA) and choose between WCAG 2.1 and 2.2.
*   **Detailed Reports:** The extension provides detailed JSON output of the scan results, including a list of violations, their impact (critical, serious, moderate, minor), and the specific HTML elements that are affected.
*   **User-Friendly Summaries:** The slash commands are designed to provide user-friendly summaries of the scan results, including tables and Markdown reports.
*   **WCAG References:** The reports include links to the relevant WCAG success criteria, as well as links to understanding and how-to-meet pages.
*   **Contextual Reports:** The `/a11y:report` command can use the JSON from the last scan to generate a formatted Markdown report.

## What it cannot do

*   **Automatic Remediation:** The extension does not automatically fix accessibility issues. It only identifies them and provides recommendations.
*   **Authentication:** The extension cannot log in to websites that require authentication. You can only scan publicly accessible pages.
*   **Complex User Interactions:** The extension cannot perform complex user interactions like filling out forms or navigating through a multi-step process. It only analyzes the page in its initial state.
*   **Guaranteed Compliance:** While axe-core is a powerful tool, it cannot guarantee 100% WCAG compliance. Manual testing is still recommended.
*   **GUI:** The extension does not have a graphical user interface. All interactions are through the command line.
