import type { GroupKind } from "../nav";

/** 아이콘은 늘 옆에 글자 라벨과 함께 쓴다. 화면 읽기에서는 숨긴다 */
const PATHS: Record<string, string> = {
  http: "M2 8h12M8 2c2 2 2.8 4 2.8 6S10 12 8 14M8 2C6 4 5.2 6 5.2 8S6 12 8 14M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2",
  message: "M2 4h12v8H2zM2 4l6 5 6-5",
  schedule: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2M8 5v3l2 2",
  event: "M9 1 3 9h4l-1 6 6-8H8z",
  grpc: "M3 3h4v4H3zM9 9h4v4H9zM7 5h3v4",
  main: "M5 3l8 5-8 5z",
  unknown: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2M6.5 6a1.5 1.5 0 1 1 2 1.4c-.5.2-.5.6-.5 1.1M8 11v.5",
  orphans: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2M6.5 6a1.5 1.5 0 1 1 2 1.4c-.5.2-.5.6-.5 1.1M8 11v.5",
  outside: "M3 2h7l3 3v9H3zM10 2v3h3",
  otherTests: "M6 2h4M7 2v4l-4 7a1 1 0 0 0 1 1.5h8A1 1 0 0 0 13 13L9 6V2",
  nonCode: "M3 2h7l3 3v9H3zM5 8h6M5 11h4",
  test: "M6 2h4M7 2v4l-4 7a1 1 0 0 0 1 1.5h8A1 1 0 0 0 13 13L9 6V2",
  warn: "M8 2 1.5 13.5h13zM8 6.5v3.5M8 11.8v.4",
  link: "M6.5 9.5l3-3M5 8 3.5 9.5a2.1 2.1 0 0 0 3 3L8 11M8 5l1.5-1.5a2.1 2.1 0 0 1 3 3L11 8",
  folder: "M2 4h4l1.5 1.5H14V13H2z",
  back: "M10 3 5 8l5 5",
  next: "M6 3l5 5-5 5",
  refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5",
  check: "M3 8.5l3 3 7-7",
};

export function Icon({ name, size = 14 }: { name: GroupKind | keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? PATHS.unknown} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
