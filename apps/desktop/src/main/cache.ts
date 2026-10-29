import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ReviewSession } from "@callpath/core";

/**
 * 정밀 분석까지 끝난 세션을 저장한다(설계 4.4). 빠른 분석은 100ms 안팎이라 저장하지 않고,
 * 비싼 LSP 결과만 base, head SHA와 분석기 버전을 키로 둔다.
 */
export class SessionCache {
  private readonly db: DatabaseSync;

  constructor(file: string, private readonly version: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      create table if not exists sessions (
        key text primary key,
        repo text not null,
        created_at integer not null,
        json text not null
      )`);
  }

  private key(repo: string, base: string, head: string): string {
    return [repo, base, head, this.version].join("\u0000");
  }

  get(repo: string, base: string, head: string): ReviewSession | null {
    const row = this.db.prepare("select json from sessions where key = ?").get(this.key(repo, base, head)) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as ReviewSession) : null;
  }

  put(session: ReviewSession): void {
    this.db
      .prepare("insert or replace into sessions (key, repo, created_at, json) values (?, ?, ?, ?)")
      .run(this.key(session.repo, session.base, session.head), session.repo, Date.now(), JSON.stringify(session));
    // 저장소마다 최근 20개만 남긴다
    this.db
      .prepare("delete from sessions where repo = ? and key not in (select key from sessions where repo = ? order by created_at desc limit 20)")
      .run(session.repo, session.repo);
  }

  close(): void {
    this.db.close();
  }
}
