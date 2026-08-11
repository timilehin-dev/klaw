// OpenAI-compatible tool definitions

export const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: [
        "Execute Python 3.11 in Klaw's secure Modal sandbox (32GB RAM, 8 CPU).",
        "Workspace is /mnt/data (cwd). Most common libraries are PREINSTALLED globally.",
        "Prefer imports without pip. Only set `dependencies` for rare packages.",
        "Write outputs under /mnt/data. Set requires_approval=true for destructive actions.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "Valid, self-contained Python 3.11 code. Save files under /mnt/data.",
          },
          dependencies: {
            type: "array",
            items: { type: "string" },
            description: "Optional rare pip packages not in the fat image.",
          },
          requires_approval: {
            type: "boolean",
            description:
              "True for destructive/irreversible actions (delete, drop tables, emails, production writes).",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: [
        "Search the live web with Tavily for research, facts, pricing, news, or documentation.",
        "Use before browser automation when you only need information, not interaction.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query string.",
          },
          max_results: {
            type: "integer",
            description: "Number of results (1-10). Default 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_action",
      description: [
        "Control a headless Chromium browser (Playwright on Modal) to navigate pages,",
        "click elements, type into fields, or capture page text/screenshots.",
        "Use for JS-heavy sites or multi-step web flows that simple HTTP scrape cannot handle.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["navigate", "click", "type", "screenshot", "content"],
            description: "Browser action to perform.",
          },
          url: {
            type: "string",
            description: "Starting URL (always required).",
          },
          selector: {
            type: "string",
            description: "CSS selector for click/type actions.",
          },
          text: {
            type: "string",
            description: "Text to type (for action=type).",
          },
          wait_ms: {
            type: "integer",
            description: "Optional settle delay after action (ms).",
          },
        },
        required: ["action", "url"],
      },
    },
  },
];
