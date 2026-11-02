import { app, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRefSource, indexFile, languageOf, parse, type Tour } from "@callpath/core";
import { annotationPayload, explain, LlmError, NoteReader, NOTE_VERSION, redact, sourceWindow, type NoteSource, type NoteStep } from "@callpath/llm";
import type { AutomaticRequest, AutomaticResult, AutomaticScope, GuideTarget } from "../shared/api";
import { automaticConfig, recordLlm } from "./llm";
import { readAt } from "./repo";

const tasks = new Map<string, { owner: number; ctl: AbortController }>();
let tail: Promise<void> = Promise.resolve();
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const cancelled = () => new LlmError("설명 작성을 멈췄습니다", "cancelled");

export function cancelAutomatic(id: string, owner: number): void {
  const t = tasks.get(id);
  if (t?.owner === owner) t.ctl.abort();
}

async function codeSource(repo: string, ref: string, path: string, id: string, from: number, to: number, budget: number): Promise<{ source: NoteSource; scope: AutomaticScope }> {
  const sha = await new GitRefSource(repo, ref).resolve();
  const text = await readAt(repo, sha, path);
  if (text === null || text.includes("\0")) throw new Error("설명할 코드 파일을 읽지 못했습니다");
  const window = sourceWindow(text, from, Math.min(to, from + 119), budget);
  let context = "";
  const lang = languageOf(path);
  if (lang) {
    const tree = await parse(lang, text);
    const idx = indexFile(path, lang, tree);
    context = JSON.stringify(idx.classes.filter(c => c.range.endLine + 1 >= from && c.range.startLine + 1 <= window.lastLine).map(c => ({ name: c.qualifiedName, fields: c.fields, methods: idx.methods.filter(m => m.classQualifiedName === c.qualifiedName).map(m => m.name) }))).slice(0, 1200);
    tree.delete();
  }
  return {
    source: { id, path, sha, firstLine: window.firstLine, text: window.text, context },
    scope: { id, path, sha, from: window.firstLine, to: window.lastLine, requestedTo: to, truncated: window.lastLine < to },
  };
}

/** 자동 설명은 승인된 코드 열기 동작에서만 호출한다. 보조 요약의 미리보기 경로와 구분한다. */
export async function automaticExplain(req: AutomaticRequest, id: string, force: boolean, sender: WebContents, tourOf: (target: GuideTarget, entryId: string) => Promise<Tour>): Promise<AutomaticResult> {
  if (tasks.has(id)) throw new Error("이미 실행 중인 설명 요청입니다");
  const ctl = new AbortController();
  tasks.set(id, { owner: sender.id, ctl });
  const destroyed = () => ctl.abort(); sender.once("destroyed", destroyed);
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(r => { release = r; });
  const emit = (event: Record<string, unknown>) => { if (!sender.isDestroyed() && !ctl.signal.aborted) sender.send("automatic-event", { id, ...event }); };
  let sent = false, answer = "";
  try {
    await previous;
    if (ctl.signal.aborted) throw cancelled();
    const cfg = await automaticConfig();
    if (!cfg) throw new LlmError("LLM 설정에서 설명을 켜고 끝점 주소와 모델을 넣으세요", "rejected");
    const sources: NoteSource[] = [], scopes: AutomaticScope[] = [], steps: NoteStep[] = [];
    if (req.kind === "code") {
      if (!req.sources.length || req.sources.length > 2 || new Set(req.sources.map(s => s.id)).size !== req.sources.length) throw new Error("설명할 코드 범위가 올바르지 않습니다");
      for (const s of req.sources) {
        const p = await codeSource(req.repo, s.ref, s.path, s.id, s.from, s.to, Math.floor(18000 / req.sources.length));
        sources.push(p.source); scopes.push(p.scope);
      }
    } else {
      const tour = await tourOf(req.target, req.entryId);
      let budget = 18000;
      for (const s of tour.steps) {
        steps.push({ n: s.n, label: s.symbol.qualifiedName, detail: JSON.stringify({ parent: s.parent, calls: s.calls, branch: s.branch, alternatives: s.alternatives, confidence: s.confidence, abstract: s.abstract, folded: s.folded, external: s.external, guesses: s.guesses }).slice(0, 1400) });
        if (budget < 1000) continue;
        const p = await codeSource(req.target.repo, req.target.sha, s.symbol.path, `step-${s.n}`, s.symbol.range.startLine + 1, s.symbol.range.endLine + 1, budget);
        sources.push(p.source); scopes.push(p.scope); budget -= p.source.text.length + 1;
      }
    }
    if (ctl.signal.aborted) throw cancelled();
    const payload = annotationPayload(sources, steps);
    const key = digest({ version: NOTE_VERSION, repo: req.kind === "code" ? req.repo : req.target.repo, kind: req.kind, sources, steps, endpoint: cfg.endpoint, model: cfg.model });
    const dir = join(app.getPath("userData"), "reading-notes");
    const file = join(dir, `${key}.json`);
    const base = { scopes, endpointHost: new URL(cfg.endpoint).host, model: cfg.model };
    const reader = () => new NoteReader(req.kind === "code" ? sources : [], steps);
    if (!force) {
      try {
        const saved = JSON.parse(await readFile(file, "utf8")) as { notes: unknown[] };
        const validator = reader(); validator.push(saved.notes.map(n => JSON.stringify(n)).join("\n") + "\n");
        return { ...base, notes: validator.finish(), cached: true };
      } catch { /* 캐시가 없거나 형식이 맞지 않으면 새로 작성한다 */ }
    }
    if (ctl.signal.aborted) throw cancelled();
    emit({ type: "scope", ...base });
    await recordLlm({ id, time: new Date().toISOString(), mode: "automatic", status: "sent", endpoint: cfg.endpoint, model: cfg.model, kind: req.kind, scope: scopes, messages: payload.messages });
    sent = true;
    const parser = reader();
    for await (const piece of explain(cfg, payload, ctl.signal, { onThinking: () => emit({ type: "thinking" }) })) {
      answer += piece;
      if (answer.length > 100000) throw new Error("설명 응답이 너무 큽니다");
      const added = parser.push(piece).map(n => ({ ...n, text: redact(n.text, cfg) }));
      if (added.length) emit({ type: "notes", notes: added });
    }
    if (ctl.signal.aborted) throw cancelled();
    const notes = parser.finish().map(n => ({ ...n, text: redact(n.text, cfg) }));
    await recordLlm({ id, time: new Date().toISOString(), mode: "automatic", status: "done", answer: redact(answer, cfg) });
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `${key}.${randomUUID()}.tmp`);
    try { await writeFile(temp, JSON.stringify({ notes }), { mode: 0o600 }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
    return { ...base, notes, cached: false };
  } catch (e) {
    const wasCancelled = ctl.signal.aborted;
    ctl.abort();
    if (sent) await recordLlm({ id, time: new Date().toISOString(), mode: "automatic", status: wasCancelled ? "cancelled" : "error", error: e instanceof Error ? e.message : "설명 작성 실패" }).catch(() => undefined);
    if (wasCancelled) throw cancelled();
    throw e;
  } finally {
    sender.removeListener("destroyed", destroyed); tasks.delete(id); release();
  }
}
