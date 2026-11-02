import { describe, expect, it } from "vitest";
import { validateNavigation } from "../src/main/navigationRequest";
import type { NavigationQuery } from "@callpath/core";
const target = { repo: "/repo", sha: "a".repeat(40), dir: null };
describe("탐색 요청 경계", () => {
  it("고정 커밋의 검색과 상대 파일 위치를 받는다", () => {
    expect(() => validateNavigation(target, {kind:"search",query:"Client"})).not.toThrow();
    expect(() => validateNavigation(target, {kind:"definition",path:"src/Client.java",position:{line:2,column:8}})).not.toThrow();
  });
  it("움직이는 ref와 범위 밖 경로, 올바르지 않은 위치는 워커로 보내지 않는다", () => {
    expect(() => validateNavigation({...target,sha:"main"}, {kind:"search",query:""})).toThrow();
    for (const path of ["../Client.java","/etc/passwd","a/../b.java","a\\b.java"]) expect(() => validateNavigation(target,{kind:"definition",path,position:{line:0,column:0}})).toThrow();
    expect(() => validateNavigation(target,{kind:"definition",path:"a.java",position:{line:-1,column:0}})).toThrow();
    expect(() => validateNavigation(target,{kind:"search",query:"",limit:NaN})).toThrow();
    expect(() => validateNavigation(target,{kind:"other"} as unknown as NavigationQuery)).toThrow();
  });
});
