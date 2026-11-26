import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";

export type ExecResult = { exitCode: number | null; output: string; durationMs: number; timedOut: boolean };
// stdoutFile: stdout goes to the file only (agent transcripts are large); stderr is always captured.
export type ExecOptions = { cwd: string; timeoutMs: number; env?: Record<string, string>; stdoutFile?: string };

const MAX_CAPTURED_CHARS = 200_000;

type Capture = { chunks: string[]; chars: number };

const appendCapped = (capture: Capture, data: Buffer): void => {
  if (capture.chars >= MAX_CAPTURED_CHARS) return;
  const text = data.toString("utf8");
  capture.chunks.push(text.slice(0, MAX_CAPTURED_CHARS - capture.chars));
  capture.chars += text.length;
};

const wireOutput = (child: ChildProcessWithoutNullStreams, capture: Capture, file: WriteStream | null): void => {
  child.stdout.on("data", (data: Buffer) => (file === null ? appendCapped(capture, data) : file.write(data)));
  child.stderr.on("data", (data: Buffer) => appendCapped(capture, data));
};

const settle =
  (startedAt: number, options: ExecOptions, capture: Capture, file: WriteStream | null) =>
  (exitCode: number | null): ExecResult => {
    file?.end();
    const durationMs = Date.now() - startedAt;
    return { exitCode, output: capture.chunks.join(""), durationMs, timedOut: durationMs >= options.timeoutMs };
  };

export const execute = (command: string[], options: ExecOptions): Promise<ExecResult> =>
  new Promise((resolve) => {
    const [program = "", ...args] = command;
    const capture: Capture = { chunks: [], chars: 0 };
    const file = options.stdoutFile === undefined ? null : createWriteStream(options.stdoutFile);
    const result = settle(Date.now(), options, capture, file);
    const child = spawn(program, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
    wireOutput(child, capture, file);
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    const finish = (exitCode: number | null): void => {
      clearTimeout(timer);
      resolve(result(exitCode));
    };
    child.on("error", (error) => {
      capture.chunks.push(`cannot start ${program}: ${error.message}`);
      finish(null);
    });
    child.on("close", finish);
  });
