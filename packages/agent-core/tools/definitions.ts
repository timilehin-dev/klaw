// OpenAI-compatible tool definitions

export const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: [
        "Execute Python 3.11 in Klaw's secure Modal sandbox (32GB RAM, 8 CPU).",
        "Best for calculations, data analysis, file generation, or API testing.",
        "Most libraries are preinstalled. Only set dependencies for rare packages.",
        "Set requires_approval=true for destructive actions.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The Python code to execute. Save files under /mnt/data.",
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
      description:
        "Search the live web for current information, news, documentation, or research (Tavily).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
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
      name: "browser_navigate",
      description:
        "Navigate to a specific URL in headless Chromium and extract the page text content.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to visit.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description:
        "Open a URL, click an element by CSS selector, and return the resulting page text.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to visit first.",
          },
          selector: {
            type: "string",
            description: "CSS selector of the element to click.",
          },
        },
        required: ["url", "selector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_action",
      description: [
        "General browser control (navigate/click/type/screenshot/content).",
        "Prefer browser_navigate or browser_click for simple cases.",
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
