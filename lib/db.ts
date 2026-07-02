import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { AiRun, CaseSummary, QccCase } from "./types";

const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "qcc.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
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
`);

export function listCases(): CaseSummary[] {
  const rows = db.prepare("SELECT payload FROM cases ORDER BY updated_at DESC").all() as Array<{ payload: string }>;
  return rows.map(({ payload }) => {
    const item = JSON.parse(payload) as QccCase;
    return {
      id: item.id, title: item.title, problemType: item.problemType, stage: item.stage, status: item.status,
      findings: item.findings.length, supportedCauses: item.hypotheses.filter((h) => h.status === "证据支持").length,
      updatedAt: item.updatedAt,
    };
  });
}

export function getCase(id: string): QccCase | null {
  const row = db.prepare("SELECT payload FROM cases WHERE id = ?").get(id) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as QccCase) : null;
}

export function saveCase(item: QccCase): QccCase {
  const now = new Date().toISOString();
  const next = { ...item, updatedAt: now };
  db.prepare(`
    INSERT INTO cases (id, title, problem_type, status, stage, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, problem_type=excluded.problem_type,
      status=excluded.status, stage=excluded.stage, payload=excluded.payload, updated_at=excluded.updated_at
  `).run(next.id, next.title, next.problemType, next.status, next.stage, JSON.stringify(next), next.createdAt, next.updatedAt);
  return next;
}

export function deleteCase(id: string): void {
  db.prepare("DELETE FROM cases WHERE id = ?").run(id);
  db.prepare("DELETE FROM ai_runs WHERE case_id = ?").run(id);
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
