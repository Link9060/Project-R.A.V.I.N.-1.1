import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  PROJECT_ROOT,
  inspectProject,
  listProjectFiles,
} from "../self/projectScanner.js";

const MAX_READ_BYTES = 200_000;
const MAX_WRITE_BYTES = 250_000;
const COMMAND_TIMEOUT_MS = 30_000;

function resolveProjectPath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim()
  ) {
    throw new Error(
      "A project-relative path is required."
    );
  }

  const resolved = path.resolve(
    PROJECT_ROOT,
    relativePath
  );

  const relativeToRoot = path.relative(
    PROJECT_ROOT,
    resolved
  );

  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(
      "Path is outside the RAVIN project."
    );
  }

  return resolved;
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(
    path.dirname(filePath),
    {
      recursive: true,
    }
  );
}

async function backupExistingFile(filePath) {
  try {
    const stat = await fs.stat(filePath);

    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const relativePath = path.relative(
    PROJECT_ROOT,
    filePath
  );

  const safeName = relativePath
    .replace(/[\\/]/g, "__")
    .replace(
      /[^a-zA-Z0-9.*-]/g,
      "*"
    );

  const backupDirectory = path.join(
    PROJECT_ROOT,
    ".ravin-backups"
  );

  await fs.mkdir(
    backupDirectory,
    {
      recursive: true,
    }
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupDirectory,
    `${timestamp}__${safeName}`
  );

  await fs.copyFile(
    filePath,
    backupPath
  );

  return path.relative(
    PROJECT_ROOT,
    backupPath
  );
}

async function readFile(
  relativePath,
  lineStart,
  lineEnd
) {
  const filePath =
    resolveProjectPath(relativePath);

  const stat = await fs.stat(
    filePath
  );

  if (!stat.isFile()) {
    throw new Error(
      `Not a file: ${relativePath}`
    );
  }

  if (
    stat.size > MAX_READ_BYTES
  ) {
    throw new Error(
      `File is too large to read safely (${stat.size} bytes).`
    );
  }

  const content =
    await fs.readFile(
      filePath,
      "utf8"
    );

  const lines =
    content.split(/\r?\n/);

  const totalLines =
    lines.length;

  let start = 1;
  let end = totalLines;

  if (
    lineStart !== undefined &&
    lineStart !== null
  ) {
    if (
      !Number.isInteger(lineStart) ||
      lineStart < 1
    ) {
      throw new Error(
        "line_start must be a positive integer."
      );
    }

    start = lineStart;
  }

  if (
    lineEnd !== undefined &&
    lineEnd !== null
  ) {
    if (
      !Number.isInteger(lineEnd) ||
      lineEnd < 1
    ) {
      throw new Error(
        "line_end must be a positive integer."
      );
    }

    end = lineEnd;
  }

  if (start > totalLines) {
    throw new Error(
      `line_start (${start}) is beyond the end of the file (${totalLines} lines).`
    );
  }

  if (end < start) {
    throw new Error(
      "line_end must be greater than or equal to line_start."
    );
  }

  end = Math.min(
    end,
    totalLines
  );

  const selectedLines =
    lines.slice(
      start - 1,
      end
    );

  const selectedContent =
    selectedLines.join("\n");

  return {
    path: path.relative(
      PROJECT_ROOT,
      filePath
    ),
    bytes: Buffer.byteLength(
      selectedContent,
      "utf8"
    ),
    content: selectedContent,
    lineStart: start,
    lineEnd: end,
    totalLines,
    partial:
      start !== 1 ||
      end !== totalLines,
  };
}

async function writeFile(
  relativePath,
  content
) {
  if (
    typeof content !== "string"
  ) {
    throw new Error(
      "File content must be a string."
    );
  }

  const byteLength =
    Buffer.byteLength(
      content,
      "utf8"
    );

  if (
    byteLength >
    MAX_WRITE_BYTES
  ) {
    throw new Error(
      `File content exceeds the ${MAX_WRITE_BYTES}-byte limit.`
    );
  }

  if (
    content.includes("\u0000")
  ) {
    throw new Error(
      "File content contains an invalid null character."
    );
  }

  const filePath =
    resolveProjectPath(
      relativePath
    );

  const backup =
    await backupExistingFile(
      filePath
    );

  await ensureParentDirectory(
    filePath
  );

  await fs.writeFile(
    filePath,
    content,
    "utf8"
  );

  const stat =
    await fs.stat(filePath);

  return {
    path: path.relative(
      PROJECT_ROOT,
      filePath
    ),
    bytes: stat.size,
    created: !backup,
    replaced: Boolean(backup),
    backup,
  };
}

/**
 * V0.1 intentionally does NOT expose
 * arbitrary shell execution.
 *
 * Allowed commands are development/
 * verification commands only.
 */
function validateCommand(command) {
  if (
    typeof command !== "string" ||
    !command.trim()
  ) {
    throw new Error(
      "A command is required."
    );
  }

  const trimmed =
    command.trim();

  /*
   * Prevent shell chaining,
   * substitutions, redirects,
   * command substitution, etc.
   */
  const dangerousShellSyntax =
    /[;&|><`$]|\r|\n/;

  if (
    dangerousShellSyntax.test(
      trimmed
    )
  ) {
    throw new Error(
      "Command contains shell syntax that is not allowed in V0.1."
    );
  }

  const npmTest =
    /^npm\s+(test|run\s+(?!start$|web$)[a-zA-Z0-9:_-]+)$/;

  const nodeCheck =
    /^node\s+--check\s+([^\s]+)$/;

  const gitCheck =
    /^(git\s+status(\s+--short)?|git\s+diff\s+--check)$/;

  if (
    npmTest.test(trimmed) ||
    nodeCheck.test(trimmed) ||
    gitCheck.test(trimmed)
  ) {
    return trimmed;
  }

  throw new Error(
    `Command not allowed in V0.1: ${trimmed}`
  );
}

function runCommand(command) {
  const safeCommand =
    validateCommand(command);

  return new Promise(
    (resolve, reject) => {
      const parts =
        safeCommand.split(
          /\s+/
        );

      const executable =
        parts.shift();

      const args = parts;

      const child = spawn(
        executable,
        args,
        {
          cwd: PROJECT_ROOT,
          shell: false,
          env: process.env,
        }
      );

      let stdout = "";
      let stderr = "";
      let finished = false;

      const timeout =
        setTimeout(() => {
          if (finished) {
            return;
          }

          finished = true;

          child.kill(
            "SIGTERM"
          );

          reject(
            new Error(
              `Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`
            )
          );
        }, COMMAND_TIMEOUT_MS);

      child.stdout.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();

          if (
            stdout.length >
            100_000
          ) {
            stdout =
              stdout.slice(
                -100_000
              );
          }
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();

          if (
            stderr.length >
            100_000
          ) {
            stderr =
              stderr.slice(
                -100_000
              );
          }
        }
      );

      child.on(
        "error",
        (error) => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(
            timeout
          );

          reject(error);
        }
      );

      child.on(
        "close",
        (code, signal) => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(
            timeout
          );

          resolve({
            command: safeCommand,
            code,
            signal,
            success:
              code === 0,
            stdout,
            stderr,
          });
        }
      );
    }
  );
}

export async function executeTool(
  name,
  args = {}
) {
  switch (name) {
    case "list_files":
      return listProjectFiles(
        args.directory || ".",
        args.recursive !== false
      );

    case "read_file":
      return readFile(
        args.path,
        args.line_start,
        args.line_end
      );

    case "write_file":
      return writeFile(
        args.path,
        args.content
      );

    case "run_command":
      return runCommand(
        args.command
      );

    case "inspect_project":
      return inspectProject();

    default:
      throw new Error(
        `Unknown tool: ${name}`
      );
  }
}

export async function executeToolCall(
  toolCall
) {
  const functionName =
    toolCall?.function?.name;

  if (!functionName) {
    throw new Error(
      "Tool call is missing a function name."
    );
  }

  let args = {};

  try {
    args = JSON.parse(
      toolCall.function.arguments ||
        "{}"
    );
  } catch {
    throw new Error(
      `Invalid JSON arguments for tool: ${functionName}`
    );
  }

  return executeTool(
    functionName,
    args
  );
}