import { Fragment } from "react";

/**
 * 좁은 칸에서 이름이 단어 경계(OrderEvent|Listener, /owners/|{id})에서만 줄을 바꾸게 한다.
 * 줄바꿈 자리(<wbr>)는 화면 읽기에서 띄어 읽히므로, 보이는 글자는 숨기고 원래 이름을 따로 읽힌다
 */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?=[A-Z][a-z])|(?<=[./])/);
  if (parts.length < 2) return <>{text}</>;
  return (
    <>
      <span aria-hidden="true">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && <wbr />}
            {p}
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}
