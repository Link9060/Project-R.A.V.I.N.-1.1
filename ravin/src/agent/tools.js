export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files and directories inside the RAVIN project. Use this to discover the project structure before editing code.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "Optional relative directory to inspect. Defaults to the project root.",
          },
          recursive: {
            type: "boolean",
            description:
              "Whether to recursively list nested files. Defaults to true.",
          },
        },
        additionalProperties: false,
      },
    },
  },

  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a project file. Use this before editing an existing file so you understand its current implementation. For large files, use line_start and line_end to read only the relevant section.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Relative path to the file inside the RAVIN project.",
          },
          line_start: {
            type: "integer",
            minimum: 1,
            description:
              "Optional 1-based line number where reading should begin. Defaults to the first line.",
          },
          line_end: {
            type: "integer",
            minimum: 1,
            description:
              "Optional 1-based line number where reading should end. Defaults to the last line.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },

  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or replace an existing project file with complete content. Existing files are backed up automatically before replacement.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Relative path to the file inside the RAVIN project.",
          },
          content: {
            type: "string",
            description:
              "The complete contents that should be written.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },

  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run an allowed development/verification command inside the RAVIN project. Use this to validate code after making changes. Arbitrary shell commands are not available.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "Allowed verification command such as 'npm test', 'npm run test', 'node --check src/index.js', 'git status', or 'git diff --check'.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },

  {
    type: "function",
    function: {
      name: "inspect_project",
      description:
        "Inspect the RAVIN project's architecture, package.json, scripts, dependencies, source files, frontend files, and directories.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];