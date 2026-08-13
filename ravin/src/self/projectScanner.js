import fs from "node:fs/promises";
import path from "node:path";

export const PROJECT_ROOT =
  process.env.RAVIN_PROJECT_ROOT || path.resolve(process.cwd());

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".ravin-backups",
  ".idea",
  ".vscode",
]);

const MAX_FILES = 600;
const MAX_DEPTH = 8;

function toRelative(filePath) {
  return path.relative(PROJECT_ROOT, filePath) || ".";
}

async function walkDirectory(directory, depth = 0, results = []) {
  if (depth > MAX_DEPTH || results.length >= MAX_FILES) {
    return results;
  }

  const entries = await fs.readdir(directory, {
    withFileTypes: true,
  });

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (results.length >= MAX_FILES) {
      break;
    }

    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push({
        type: "directory",
        path: toRelative(fullPath),
      });

      await walkDirectory(fullPath, depth + 1, results);
      continue;
    }

    if (entry.isFile()) {
      results.push({
        type: "file",
        path: toRelative(fullPath),
      });
    }
  }

  return results;
}

async function readPackageJson() {
  const packagePath = path.join(PROJECT_ROOT, "package.json");

  try {
    const raw = await fs.readFile(packagePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createDirectorySummary(entries) {
  const directories = entries
    .filter((entry) => entry.type === "directory")
    .map((entry) => entry.path);

  return directories;
}

function createFileSummary(entries) {
  return entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path);
}

export async function inspectProject() {
  const packageJson = await readPackageJson();

  const entries = await walkDirectory(PROJECT_ROOT);

  const files = createFileSummary(entries);
  const directories = createDirectorySummary(entries);

  const sourceFiles = files.filter(
    (file) =>
      file.endsWith(".js") ||
      file.endsWith(".mjs") ||
      file.endsWith(".cjs") ||
      file.endsWith(".ts") ||
      file.endsWith(".tsx") ||
      file.endsWith(".jsx")
  );

  const frontendFiles = files.filter(
    (file) =>
      file.startsWith("public/") ||
      file.startsWith("frontend/") ||
      file.startsWith("web/")
  );

  const backendFiles = files.filter(
    (file) =>
      file.startsWith("src/") ||
      file === "server.js" ||
      file === "index.js"
  );

  return {
    projectRoot: PROJECT_ROOT,
    projectName: packageJson?.name || path.basename(PROJECT_ROOT),
    version: packageJson?.version || null,
    description: packageJson?.description || null,
    type: packageJson?.type || null,
    entryPoint: packageJson?.main || null,
    scripts: packageJson?.scripts || {},
    dependencies: packageJson?.dependencies || {},
    devDependencies: packageJson?.devDependencies || {},
    counts: {
      files: files.length,
      directories: directories.length,
      sourceFiles: sourceFiles.length,
      frontendFiles: frontendFiles.length,
      backendFiles: backendFiles.length,
    },
    sourceFiles,
    frontendFiles,
    backendFiles,
    directories,
    files,
    truncated: files.length >= MAX_FILES,
  };
}

export async function listProjectFiles(
  directory = ".",
  recursive = true
) {
  const targetDirectory = path.resolve(PROJECT_ROOT, directory);

  if (!targetDirectory.startsWith(PROJECT_ROOT)) {
    throw new Error("Directory is outside the RAVIN project.");
  }

  const stat = await fs.stat(targetDirectory);

  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${directory}`);
  }

  if (recursive) {
    const entries = await walkDirectory(targetDirectory);

    return {
      directory: toRelative(targetDirectory),
      entries,
    };
  }

  const entries = await fs.readdir(targetDirectory, {
    withFileTypes: true,
  });

  return {
    directory: toRelative(targetDirectory),
    entries: entries
      .filter(
        (entry) =>
          !(
            entry.isDirectory() &&
            SKIPPED_DIRECTORIES.has(entry.name)
          )
      )
      .map((entry) => ({
        type: entry.isDirectory() ? "directory" : "file",
        path: path.join(
          toRelative(targetDirectory),
          entry.name
        ),
      })),
  };
}