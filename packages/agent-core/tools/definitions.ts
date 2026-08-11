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
  {
    type: "function",
    function: {
      name: "create_memory",
      description:
        "Store a fact or entity in long-term memory. Use when you learn something important about the user's business, team, or projects.",
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description:
              "Entity name (e.g. 'John Smith', 'Project Apollo', 'Stripe API').",
          },
          entity_type: {
            type: "string",
            description:
              "Type: person, project, tool, concept, company.",
          },
          observations: {
            type: "array",
            items: { type: "string" },
            description: "List of facts/observations about this entity.",
          },
        },
        required: ["entity_name", "entity_type", "observations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description:
        "Search long-term memory for facts about a topic, person, or project.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to search for in memory.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_create_entity",
      description:
        "Alias of create_memory with optional observations. Creates/updates a graph entity.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          entity_type: {
            type: "string",
            enum: ["person", "project", "tool", "concept", "company"],
          },
          observations: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["name", "entity_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_add_observation",
      description:
        "Append a durable observation to an existing memory entity (creates it if missing).",
      parameters: {
        type: "object",
        properties: {
          entity_name: { type: "string" },
          observation: { type: "string" },
        },
        required: ["entity_name", "observation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_create_relation",
      description:
        "Link two memory entities with a relation (e.g. works_on, uses, manages).",
      parameters: {
        type: "object",
        properties: {
          source_entity: { type: "string" },
          target_entity: { type: "string" },
          relation_type: { type: "string" },
        },
        required: ["source_entity", "target_entity", "relation_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_search",
      description: "Alias of search_memory for graph search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_task",
      description: [
        "Create a recurring proactive agent job (agentic cron).",
        "cron_expression is 5-field UTC cron, e.g. '0 9 * * 1-5' for 09:00 UTC weekdays.",
        "The agent will run the prompt on schedule and can post to slack_channel.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          cron_expression: { type: "string" },
          prompt: { type: "string" },
          slack_channel: {
            type: "string",
            description: "Optional Slack channel ID for results.",
          },
        },
        required: ["name", "cron_expression", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_tasks",
      description: "List proactive scheduled tasks for this workspace.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];
