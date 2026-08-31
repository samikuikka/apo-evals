/**
 * python — execute Python code for the DABstep agent, safely enough for a
 * benchmark runner: child process, no shell, hard timeout, bounded output.
 *
 * The working directory is the DABstep context directory, so agent code can
 * reference files by their bare names (pd.read_csv("payments.csv")). A repo
 * venv with pandas is preferred when present; plain python3 (stdlib csv/json)
 * works otherwise.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 20_000;

export type PythonResult = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
};

export function resolvePythonBin(repoRoot: string): string {
  if (process.env.DABSTEP_PYTHON) return process.env.DABSTEP_PYTHON;
  return join(repoRoot, ".venv/bin/python");
}

export async function runPython(code: string, cwd: string, bin: string): Promise<PythonResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, ["-c", code], {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    });
    return {
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exit_code: 0,
      timed_out: false,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    return {
      stdout: truncate(e.stdout ?? ""),
      stderr: truncate(e.stderr ?? String(err)),
      exit_code: typeof e.code === "number" ? e.code : null,
      timed_out: e.killed === true,
    };
  }
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return `${s.slice(0, MAX_OUTPUT_CHARS)}\n... [truncated at ${MAX_OUTPUT_CHARS} chars]`;
}
