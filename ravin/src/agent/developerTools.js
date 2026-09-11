// Privileged self-development tools.
// IMPORTANT: These definitions are intentionally NOT imported by normal customer Work mode.
// Only the dedicated self-builder/developer agent may receive them.
export const DEVELOPER_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories inside the RAVIN project. Use this to discover the project structure before editing code.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Optional relative directory to inspect. Defaults to the project root." },
          recursive: { type: "boolean", description: "Whether to recursively list nested files. Defaults to true." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a RAVIN project file. Read relevant files before modifying them.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path inside the RAVIN project." },
          line_start: { type: "integer", minimum: 1 },
          line_end: { type: "integer", minimum: 1 },
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
      description: "Create or replace a project file. Existing files are backed up before replacement.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path inside the RAVIN project." },
          content: { type: "string", description: "Complete UTF-8 file contents." },
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
      description: "Run one of RAVIN's allow-listed development verification commands. Arbitrary shell execution is not available.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Allowed verification command such as npm test, node --check <file>, git status, or git diff --check." },
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
      description: "Inspect RAVIN's project architecture, package metadata, source tree, frontend files, and scripts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];
