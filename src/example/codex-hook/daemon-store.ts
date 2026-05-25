import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../../shared/constants.js";
import { loadJson, saveJson } from "../../shared/store.js";

export interface HookDaemonEnvelope {
  id: string;
  createdAt: string;
  type: "codex-hook";
  deliverUntil: string;
  rawInput: string;
  accountId: string;
  target: {
    toUserId: string;
    contextToken?: string;
    source: "configured" | "session" | "stored";
  };
}

export interface HookDaemonState {
  pid: number;
  startedAt: string;
}

export interface HookQueueEntry extends HookDaemonEnvelope {
  availableAfter?: string;
  attempts?: number;
}

function getDaemonRoot(): string {
  return join(getDataDir(), "codex-hook-daemon");
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function getDaemonInboxDir(): string {
  return ensureDir(join(getDaemonRoot(), "inbox"));
}

export function getDaemonQueueDir(): string {
  return ensureDir(join(getDaemonRoot(), "queue"));
}

export function getDaemonSentDir(): string {
  return ensureDir(join(getDaemonRoot(), "sent"));
}

export function getDaemonFailedDir(): string {
  return ensureDir(join(getDaemonRoot(), "failed"));
}

export function getDaemonLockPath(): string {
  ensureDir(getDaemonRoot());
  return join(getDaemonRoot(), "daemon.lock");
}

export function getDaemonDebugLogPath(): string {
  ensureDir(getDaemonRoot());
  return join(getDaemonRoot(), "daemon-debug.log");
}

function buildItemPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function loadDaemonState(): HookDaemonState | undefined {
  return loadJson<HookDaemonState | undefined>(getDaemonLockPath(), undefined);
}

export function isDaemonRunning(): boolean {
  const state = loadDaemonState();
  return Boolean(state?.pid && isProcessAlive(state.pid));
}

export function tryAcquireDaemonLock(): boolean {
  const lockPath = getDaemonLockPath();

  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        } satisfies HookDaemonState,
        null,
        2,
      ),
      "utf8",
    );
    closeSync(fd);
    return true;
  } catch {
    const current = loadDaemonState();
    if (current?.pid && !isProcessAlive(current.pid)) {
      rmSync(lockPath, { force: true });
      return tryAcquireDaemonLock();
    }

    return false;
  }
}

export function releaseDaemonLock(): void {
  rmSync(getDaemonLockPath(), { force: true });
}

export function logDaemonDebug(message: string): void {
  appendFileSync(getDaemonDebugLogPath(), `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

export function enqueueDaemonInbox(envelope: HookDaemonEnvelope): string {
  const filePath = buildItemPath(getDaemonInboxDir(), envelope.id);
  saveJson(filePath, envelope);
  return filePath;
}

export function listDaemonInboxPaths(): string[] {
  return readdirSync(getDaemonInboxDir())
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(getDaemonInboxDir(), name));
}

export function listDaemonQueuePaths(): string[] {
  return readdirSync(getDaemonQueueDir())
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(getDaemonQueueDir(), name));
}

export function loadDaemonEnvelope(filePath: string): HookDaemonEnvelope {
  const value = loadJson<HookDaemonEnvelope | null>(filePath, null);
  if (!value) {
    throw new Error(`Invalid daemon inbox item: ${filePath}`);
  }
  return value;
}

export function loadQueueEntry(filePath: string): HookQueueEntry {
  const value = loadJson<HookQueueEntry | null>(filePath, null);
  if (!value) {
    throw new Error(`Invalid daemon queue item: ${filePath}`);
  }
  return value;
}

export function moveInboxItemToQueue(filePath: string, availableAfter?: string): string {
  const envelope = loadDaemonEnvelope(filePath);
  const queuePath = buildItemPath(getDaemonQueueDir(), envelope.id);
  saveJson(queuePath, {
    ...envelope,
    availableAfter,
    attempts: 0,
  } satisfies HookQueueEntry);
  unlinkSync(filePath);
  return queuePath;
}

export function markQueueEntrySent(filePath: string): void {
  renameSync(filePath, buildItemPath(getDaemonSentDir(), filePath.split(/[\\/]/).pop()!.replace(/\.json$/, "")));
}

export function markQueueEntryFailed(filePath: string, errorMessage: string): void {
  const entry = loadQueueEntry(filePath);
  saveJson(buildItemPath(getDaemonFailedDir(), entry.id), {
    ...entry,
    failedAt: new Date().toISOString(),
    error: errorMessage,
  });
  rmSync(filePath, { force: true });
}

export function updateQueueEntry(filePath: string, entry: HookQueueEntry): void {
  saveJson(filePath, entry);
}

export function removeQueueEntry(filePath: string): void {
  rmSync(filePath, { force: true });
}

export function clearStaleInboxItem(filePath: string): void {
  rmSync(filePath, { force: true });
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function daemonDataFile(name: string): string {
  ensureDir(getDaemonRoot());
  return join(getDaemonRoot(), name);
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
