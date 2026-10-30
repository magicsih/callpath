import { Fragment } from "react";

/** 좁은 칸에서 이름이 단어 경계(OrderEvent|Listener, /owners/|{id})에서만 줄을 바꾸게 한다 */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?=[A-Z][a-z])|(?<=[./])/);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {p}
        </Fragment>
      ))}
    </>
  );
}
