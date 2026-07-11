import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { AiRun, CaseSummary, QccCase } from "./types";
import { normalizeCase } from "./case-utils";

const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "qcc.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    problem_type TEXT NOT NULL,
    status TEXT NOT NULL,
    stage INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    action TEXT NOT NULL,
    engine TEXT NOT NULL,
    model TEXT NOT NULL,
    input_summary TEXT NOT NULL,
    output_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
const caseColumns = db.prepare("PRAGMA table_info(cases)").all() as Array<{ name: string }>;
if (!caseColumns.some((column) => column.name === "version")) db.exec("ALTER TABLE cases ADD COLUMN version INTEGER NOT NULL DEFAULT 1");

export function listCases(): CaseSummary[] {
  const rows = db.prepare("SELECT payload FROM cases ORDER BY updated_at DESC").all() as Array<{ payload: string }>;
  return rows.map(({ payload }) => {
    const item = normalizeCase(JSON.parse(payload) as QccCase);
    return {
      id: item.id, title: item.title, problemType: item.problemType, stage: item.stage, status: item.status,
      findings: item.findings.length, supportedCauses: item.hypotheses.filter((h) => h.status === "证据支持").length,
      updatedAt: item.updatedAt,
    };
  });
}

export function getCase(id: string): QccCase | null {
  const row = db.prepare("SELECT payload FROM cases WHERE id = ?").get(id) as { payload: string } | undefined;
  return row ? normalizeCase(JSON.parse(row.payload) as QccCase) : null;
}

export function saveCase(item: QccCase): QccCase {
  const now = new Date().toISOString();
  const normalized = normalizeCase(item);
  const next = { ...normalized, updatedAt: now, version: normalized.version || 1 };
  db.prepare(`
    INSERT INTO cases (id, title, problem_type, status, stage, payload, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, problem_type=excluded.problem_type,
      status=excluded.status, stage=excluded.stage, payload=excluded.payload, updated_at=excluded.updated_at, version=excluded.version
  `).run(next.id, next.title, next.problemType, next.status, next.stage, JSON.stringify(next), next.createdAt, next.updatedAt, next.version);
  return next;
}

export function saveCaseVersioned(item: QccCase, expectedVersion: number): QccCase | null {
  const current = getCase(item.id);
  if (!current || current.version !== expectedVersion) return null;
  const now = new Date().toISOString();
  const next = { ...normalizeCase(item), version: expectedVersion + 1, updatedAt: now };
  const result = db.prepare(`UPDATE cases SET title = ?, problem_type = ?, status = ?, stage = ?, payload = ?, updated_at = ?, version = ? WHERE id = ? AND version = ?`)
    .run(next.title, next.problemType, next.status, next.stage, JSON.stringify(next), next.updatedAt, next.version, next.id, expectedVersion);
  return result.changes === 1 ? next : null;
}

export function deleteCase(id: string): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM ai_runs WHERE case_id = ?").run(id);
    const deleted = db.prepare("DELETE FROM cases WHERE id = ?").run(id).changes === 1;
    db.exec("COMMIT");
    return deleted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordAiRun(run: Omit<AiRun, "id">): void {
  db.prepare(`INSERT INTO ai_runs (case_id, action, engine, model, input_summary, output_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(run.caseId, run.action, run.engine, run.model, run.inputSummary, run.outputJson, run.createdAt);
}

export function listAiRuns(caseId: string): AiRun[] {
  const rows = db.prepare("SELECT id, case_id, action, engine, model, input_summary, output_json, created_at FROM ai_runs WHERE case_id = ? ORDER BY id DESC").all(caseId) as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    id: Number(row.id), caseId: String(row.case_id), action: String(row.action) as AiRun["action"],
    engine: String(row.engine), model: String(row.model), inputSummary: String(row.input_summary),
    outputJson: String(row.output_json), createdAt: String(row.created_at),
  }));
}

export function caseCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM cases").get() as { count: number };
  return row.count;
}

export function samplesWereInitialized(): boolean {
  return Boolean(db.prepare("SELECT value FROM app_metadata WHERE key = 'samples_initialized'").get());
}

export function markSamplesInitialized(): void {
  db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('samples_initialized', 'true')").run();
}
