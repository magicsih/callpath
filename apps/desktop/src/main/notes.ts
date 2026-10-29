import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { canComment, type PullRequestInfo } from "@callpath/providers";
import type { Note, NoteScope, PostPlan, PostResult, PrMeta } from "../shared/api";
import { providerForHost } from "./connections";

let db: DatabaseSync | null = null;

/** 메모는 사용자가 쓴 글이라 캐시와 따로 notes.db에 둔다(캐시를 지워도 남는다) */
function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(app.getPath("userData"), { recursive: true });
  db = new DatabaseSync(join(app.getPath("userData"), "notes.db"));
  db.exec(`
    create table if not exists notes (
      id integer primary key autoincrement,
      repo text not null, base text not null, head text not null,
      path text not null, line integer not null, body text not null,
      created_at integer not null,
      posted_url text, posted_mode text
    );
    create index if not exists notes_scope on notes (repo, base, head);`);
  return db;
}

interface Row {
  id: number;
  path: string;
  line: number;
  body: string;
  created_at: number;
  posted_url: string | null;
  posted_mode: "line" | "general" | null;
}

const toNote = (r: Row): Note => ({
  id: r.id, path: r.path, line: r.line, body: r.body, createdAt: r.created_at,
  posted: r.posted_url && r.posted_mode ? { url: r.posted_url, mode: r.posted_mode } : null,
});

export function listNotes(s: NoteScope): Note[] {
  const rows = open().prepare("select * from notes where repo = ? and base = ? and head = ? order by path, line, id").all(s.repo, s.base, s.head) as unknown as Row[];
  return rows.map(toNote);
}

export function addNote(s: NoteScope, n: { path: string; line: number; body: string }): Note {
  const body = n.body.trim();
  if (!body) throw new Error("메모 내용을 넣으세요");
  const r = open().prepare("insert into notes (repo, base, head, path, line, body, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(s.repo, s.base, s.head, n.path, n.line, body, Date.now());
  return toNote(open().prepare("select * from notes where id = ?").get(Number(r.lastInsertRowid)) as unknown as Row);
}

export function deleteNote(id: number): void {
  open().prepare("delete from notes where id = ?").run(id);
}

function noteById(id: number): Row | null {
  return (open().prepare("select * from notes where id = ?").get(id) as unknown as Row | undefined) ?? null;
}

function prInfo(pr: PrMeta): PullRequestInfo {
  return { ...pr, cloneUrl: "", fetchRef: "" };
}

function providerFor(pr: PrMeta) {
  const p = providerForHost(pr.kind, pr.host);
  if (!p) throw new Error(`${pr.host}에 연결하지 않았습니다. 연결 설정에서 추가하세요`);
  return p;
}

/** diff 안의 줄은 줄 코멘트로, 밖의 줄은 위치를 적은 일반 코멘트로 올린다(설계 3.7) */
export async function planPost(pr: PrMeta, ids: number[]): Promise<PostPlan[]> {
  const ranges = await providerFor(pr).diffRanges(prInfo(pr));
  return ids.map((id) => {
    const n = noteById(id);
    if (!n) throw new Error("메모를 찾지 못했습니다");
    const inside = canComment(ranges, n.path, n.line);
    return inside
      ? { noteId: id, mode: "line", path: n.path, line: n.line, body: n.body }
      : { noteId: id, mode: "general", path: n.path, line: n.line, body: `\`${n.path}:${n.line}\`\n\n${n.body}` };
  });
}

export async function postNotes(pr: PrMeta, plans: PostPlan[]): Promise<PostResult[]> {
  const provider = providerFor(pr);
  const info = prInfo(pr);
  const out: PostResult[] = [];
  for (const p of plans) {
    try {
      const posted = p.mode === "line" ? await provider.postLineComment(info, { path: p.path, line: p.line, body: p.body }) : await provider.postGeneralComment(info, p.body);
      open().prepare("update notes set posted_url = ?, posted_mode = ? where id = ?").run(posted.url, posted.mode, p.noteId);
      out.push({ noteId: p.noteId, ok: true, url: posted.url });
    } catch (e) {
      out.push({ noteId: p.noteId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
