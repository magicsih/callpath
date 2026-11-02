import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { launch, makeUserData } from "./harness";

test("앱, 창, macOS에 Callpath 이름을 표시한다", async () => {
  const userData = makeUserData();
  const { app, page } = await launch(userData);
  try {
    expect(await app.evaluate(({ app }) => app.getName())).toBe("Callpath");
    expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(userData);
    await expect(page).toHaveTitle("Callpath");
    if (process.platform === "darwin") {
      // app.getName과 별개로 macOS가 실제 실행 중인 프로세스에 붙인 이름을 확인한다
      const pid = app.process().pid!;
      const identity = execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", `
        ObjC.import("AppKit");
        const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid});
        JSON.stringify({ name: ObjC.unwrap(running.localizedName), id: ObjC.unwrap(running.bundleIdentifier) });
      `], { encoding: "utf8" });
      expect(JSON.parse(identity)).toEqual({ name: "Callpath", id: "io.github.magicsih.callpath.dev" });
    }
  } finally {
    await app.close();
  }
});
