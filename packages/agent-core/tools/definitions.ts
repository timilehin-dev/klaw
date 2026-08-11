// OpenAI-compatible tool definitions

export const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Execute Python code in a secure sandbox to perform calculations, data analysis, generate files, or scrape web pages. Use this for complex tasks that require computation.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "The Python code to execute. Must be valid, self-contained Python 3.11 code. Print outputs to stdout.",
          },
        },
        required: ["code"],
      },
    },
  },
];
