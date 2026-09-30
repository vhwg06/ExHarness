// Local git workspace adapter for BackendWorker.
// Declared edits are committed inside an isolated detached worktree. The source repository's HEAD,
// branches and working tree are never modified. This is a trusted local fixture, not a sandbox.
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const LocalWorkspaceErrorCode = Object.freeze({
  UNSAFE_PATH: "LOCAL_WORKSPACE_UNSAFE_PATH",
  REVISION_MISMATCH: "LOCAL_WORKSPACE_REVISION_MISMATCH",
  INVALID_REVISION: "LOCAL_WORKSPACE_INVALID_REVISION",
  UNSUPPORTED_ACTION: "LOCAL_WORKSPACE_UNSUPPORTED_ACTION",
  DISPOSED: "LOCAL_WORKSPACE_DISPOSED"
});

export const LOCAL_WORKSPACE_IDENTITY = Object.freeze({
  name: "EXHARNESS_LOCAL_WORKSPACE",
  email: "exharness-local-workspace@localhost.invalid"
});

function workspaceError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

// Every git process uses an argument array with shell:false; no command string is ever interpolated.
export async function git(cwd, args, { env = {} } = {}) {
  const { stdout } = await run("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", ...env }
  });
  return stdout;
}

export function assertSafeWorkspacePath(path) {
  const unsafe = (reason) => workspaceError(LocalWorkspaceErrorCode.UNSAFE_PATH, `${reason}: ${JSON.stringify(path)}`);
  if (typeof path !== "string" || path.length === 0) throw unsafe("path must be a non-empty string");
  if (path.includes("\\") || path.includes("\0")) throw unsafe("path must be relative POSIX");
  if (path.startsWith("/")) throw unsafe("absolute path");
  if (/^[A-Za-z]:/.test(path)) throw unsafe("drive letter");
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === ".")) throw unsafe("empty or dot segment");
  if (segments.includes("..")) throw unsafe("parent traversal");
  if (segments.some((segment) => segment.toLowerCase() === ".git")) throw unsafe(".git segment");
  return path;
}

export async function createLocalGitWorkspace({ repositoryRoot, baseRevision, worktreeRoot }) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) throw new TypeError("createLocalGitWorkspace requires repositoryRoot");
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) throw new TypeError("createLocalGitWorkspace requires worktreeRoot");
  if (!/^[0-9a-f]{40}$/.test(baseRevision ?? "")) {
    throw workspaceError(LocalWorkspaceErrorCode.INVALID_REVISION, "baseRevision must be a full 40-hex commit sha");
  }
  const source = resolve(repositoryRoot);
  const root = resolve(worktreeRoot);
  try {
    await git(source, ["cat-file", "-e", `${baseRevision}^{commit}`]);
  } catch {
    throw workspaceError(LocalWorkspaceErrorCode.INVALID_REVISION, `commit not found in repository: ${baseRevision}`);
  }
  await git(source, ["worktree", "add", "--detach", root, baseRevision]);
  let disposed = false;

  const assertOpen = () => {
    if (disposed) throw workspaceError(LocalWorkspaceErrorCode.DISPOSED, "workspace was disposed");
  };
  async function head() {
    assertOpen();
    return (await git(root, ["rev-parse", "HEAD"])).trim();
  }

  async function act({ candidate, action }) {
    assertOpen();
    if (action?.kind !== "APPLY_BACKEND_CHANGE") {
      throw workspaceError(LocalWorkspaceErrorCode.UNSUPPORTED_ACTION, `unsupported action kind: ${action?.kind ?? "null"}`);
    }
    const edits = action.edits ?? [];
    if (!Array.isArray(edits)) throw new TypeError("APPLY_BACKEND_CHANGE edits must be an array");
    // Validate every edit before writing anything.
    for (const edit of edits) {
      assertSafeWorkspacePath(edit?.path);
      if (typeof edit.content !== "string") throw new TypeError(`edit content must be a string: ${edit.path}`);
    }
    const current = await head();
    if (candidate?.version !== current) {
      throw workspaceError(LocalWorkspaceErrorCode.REVISION_MISMATCH, `workspace HEAD ${current} differs from candidate ${candidate?.version ?? "null"}`);
    }
    for (const edit of edits) {
      const target = join(root, ...edit.path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, edit.content);
    }
    const status = (await git(root, ["status", "--porcelain", "--untracked-files=all"])).trim();
    if (status === "") return { mutated: false, candidate };

    await git(root, ["add", "-A"]);
    await git(root, ["-c", "commit.gpgsign=false", "commit", "--no-verify", "-q", "-m", "APPLY_BACKEND_CHANGE"], {
      env: {
        GIT_AUTHOR_NAME: LOCAL_WORKSPACE_IDENTITY.name,
        GIT_AUTHOR_EMAIL: LOCAL_WORKSPACE_IDENTITY.email,
        GIT_COMMITTER_NAME: LOCAL_WORKSPACE_IDENTITY.name,
        GIT_COMMITTER_EMAIL: LOCAL_WORKSPACE_IDENTITY.email
      }
    });
    const sha = await head();
    const paths = [...new Set(edits.map((edit) => edit.path))];
    return {
      mutated: true,
      candidate: { id: candidate.id, version: sha },
      result: { artifacts: paths.map((path) => ({ ref: `git:${sha}:${path}`, path })) }
    };
  }

  async function observe({ candidate }) {
    const current = await head();
    const files = (await git(root, ["ls-files"])).split("\n").filter(Boolean);
    return { candidate, head: current, files };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      await git(source, ["worktree", "remove", "--force", root]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await git(source, ["worktree", "prune"]).catch(() => {});
    }
  }

  return Object.freeze({ root, act, observe, head, dispose });
}
