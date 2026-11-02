import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { NavigationClass, NavigationQuery, NavigationReply } from "@callpath/core";
import type { LlmSettingsView } from "../../../shared/api";
import { CodeNavigationContext, ClassSearchButton, type CodeNavigationController, type EditorBinding, type NavigationScope } from "../codeNavigation";
import { monaco, languageFor } from "../monaco";
import { KIND_LABEL } from "../guideNav";
import { AutomaticReading } from "./AutomaticReading";
import { CodeView } from "./CodeView";

type Place = { target: NavigationScope; symbol: NavigationClass; state: monaco.editor.ICodeEditorViewState | null; serial: number };
type Choice = { title: string; target: NavigationScope; items: NavigationClass[]; chooseType: boolean };
const empty: NavigationReply = { items: [], total: 0 };

/** 원래 보기와 편집기를 보존한 채 타입 코드를 따라 읽는다. */
export function ClassNavigation({ targets, active, settings, onSettings, onCoveredChange, children, pendingMessage }: {
  targets: NavigationScope[]; active: boolean; settings: LlmSettingsView | null; onSettings: () => void;
  onCoveredChange: (covered: boolean) => void; children: ReactNode; pendingMessage?: string;
}) {
  const bindings = useRef(new Map<string, EditorBinding>()), focused = useRef<EditorBinding | null>(null);
  const targetsRef = useRef(targets); targetsRef.current = targets;
  const activeRef = useRef(active); activeRef.current = active;
  const history = useRef<Array<Place | null>>([null]), cursor = useRef(0), serial = useRef(0), epoch = useRef(0);
  const origin = useRef<{ editor: EditorBinding | null; state: monaco.editor.ICodeEditorViewState | null; element: HTMLElement | null } | null>(null);
  const [revision, refresh] = useState(0), [message, setMessage] = useState<string | null>(null);
  const place = history.current[cursor.current] ?? null;
  const [choice, setChoice] = useState<Choice | null>(null), [searching, setSearching] = useState(false), [query, setQuery] = useState("");
  const [source, setSource] = useState(targets.at(-1)?.source ?? "code"), [limit, setLimit] = useState(100);
  const [result, setResult] = useState<NavigationReply>(empty), [loading, setLoading] = useState(false), [selection, setSelection] = useState(0);
  const [resultKey, setResultKey] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), before = useRef<HTMLElement | null>(null);
  const listId = useId();
  const scopeKey = JSON.stringify(targets);
  const previousScope = useRef(scopeKey);
  useEffect(()=>{
    if (!targets.length) return;
    if (previousScope.current!=="[]" && previousScope.current!==scopeKey) {
      epoch.current++; history.current=[null]; cursor.current=0; origin.current=null; setSearching(false); setChoice(null); setMessage(null); refresh(n=>n+1);
    }
    previousScope.current=scopeKey;
  },[scopeKey]);
  const target = targets.find(t => t.source === source) ?? targets.at(-1);
  const pickerTarget = choice?.target ?? target;
  const searchKey = JSON.stringify([target,query,limit]);
  const runRef = useRef<(binding: EditorBinding, kind: "definition" | "implementations") => void>(() => {});
  const targetFor = useCallback((id: string) => targetsRef.current.find(t => t.source === id) ?? targetsRef.current.at(-1), [scopeKey]);
  const ask = useCallback(async (target: NavigationScope, query: NavigationQuery): Promise<NavigationReply> => {
    const r = await window.callpath.navigation({ repo: target.repo, sha: target.sha, dir: target.dir }, query);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }, []);
  const snapshot = () => {
    const current = history.current[cursor.current];
    if (current && focused.current?.editor.getDomNode()?.closest(".navigation-reader")) current.state = focused.current.editor.saveViewState();
  };
  const open = (symbol: NavigationClass, target: NavigationScope) => {
    epoch.current++; setMessage(null); snapshot();
    if (!cursor.current) origin.current = { editor: focused.current, state: focused.current?.editor.saveViewState() ?? null, element: searching || choice ? before.current : document.activeElement as HTMLElement | null };
    history.current = [...history.current.slice(0, cursor.current + 1), { symbol, target, state: null, serial: ++serial.current }];
    if (history.current.length > 51) history.current.splice(1, 1);
    cursor.current = history.current.length - 1;
    setSearching(false); setChoice(null); refresh(n => n + 1);
  };
  const chooseReply = (reply: NavigationReply, target: NavigationScope, kind: "definition" | "implementations") => {
    setPickerError(null); setLoading(false);
    if (!reply.items.length) { setMessage(kind === "definition" ? "이 위치에서 저장소 안의 타입 선언을 찾지 못했습니다. 외부 타입이거나 클래스명이 아닐 수 있습니다." : "현재 범위에 확인된 구현체가 없습니다."); return; }
    if (reply.items.length === 1 && !reply.chooseType) open(reply.items[0]!, target);
    else { if(!dialog.current?.open) before.current = document.activeElement as HTMLElement; setChoice({ title: reply.chooseType ? "구현체를 찾을 타입 선택" : kind === "definition" ? "타입 선언 선택" : "구현체 선택", target, items: reply.items, chooseType: !!reply.chooseType }); setQuery(""); setSelection(0); }
  };
  const move = (delta: number) => {
    const next = cursor.current + delta;
    if (next < 0 || next >= history.current.length) return;
    epoch.current++; snapshot(); cursor.current = next; setMessage(null); refresh(n => n + 1);
    if (!next) requestAnimationFrame(() => {
      const saved = origin.current;
      if (saved?.editor && [...bindings.current.values()].includes(saved.editor)) { if (saved.state) saved.editor.editor.restoreViewState(saved.state); saved.editor.editor.focus(); focused.current = saved.editor; }
      else saved?.element?.isConnected && saved.element.focus();
    });
  };
  const search = () => {
    if (!activeRef.current) return;
    before.current = document.activeElement as HTMLElement;
    setSource((history.current[cursor.current]?.target ?? focused.current?.target ?? targetsRef.current.at(-1))?.source ?? "code");
    setSearching(true); setChoice(null); setQuery(""); setSelection(0); setLimit(100); setPickerError(null);
  };
  const close = () => { epoch.current++; setSearching(false); setChoice(null); setLoading(false); setPickerError(null); before.current?.isConnected && before.current.focus(); };

  // 공급자는 편집기 모델 URI로 커밋과 조각의 원본 줄을 찾는다. 요청이 바뀌면 지난 답은 이동시키지 않는다.
  const replies = useRef(new Map<string, Promise<NavigationReply>>());
  const resolve = async (model: monaco.editor.ITextModel, pos: monaco.Position, kind: "definition" | "implementations") => {
    const binding = bindings.current.get(model.uri.toString());
    if (!binding) return empty;
    const key = JSON.stringify([model.uri.toString(), pos.lineNumber, pos.column, kind]);
    let p = replies.current.get(key);
    if (!p) {
      p = ask(binding.target, { kind, path: binding.path, position: { line: pos.lineNumber + binding.firstLine - 2, column: pos.column - 1 } });
      replies.current.set(key, p); p.catch(() => replies.current.delete(key));
      while (replies.current.size > 50) replies.current.delete(replies.current.keys().next().value!);
    }
    return p;
  };
  const locations = (target: NavigationScope, r: NavigationReply): monaco.languages.Location[] => r.items.map(c => ({ uri: monaco.Uri.from({ scheme: "callpath-definition", authority: target.sha, path: "/" + c.path, query: new URLSearchParams({ id: c.id }).toString() }), range: new monaco.Range(c.namePos.line + 1, c.namePos.column + 1, c.namePos.line + 1, c.namePos.column + c.name.split(".").at(-1)!.length + 1) }));
  const providers = useRef({
    provideDefinition: async (model: monaco.editor.ITextModel, pos: monaco.Position) => { const binding = bindings.current.get(model.uri.toString()); return binding ? locations(binding.target, await resolve(model, pos, "definition")) : []; },
    provideImplementation: async (model: monaco.editor.ITextModel, pos: monaco.Position) => { const binding = bindings.current.get(model.uri.toString()); const r = await resolve(model, pos, "implementations"); return binding && !r.chooseType ? locations(binding.target, r) : []; },
  });
  useEffect(() => {
    const selector = [{ language: "java", scheme: "callpath" }, { language: "kotlin", scheme: "callpath" }];
    const defs = monaco.languages.registerDefinitionProvider(selector, providers.current), impls = monaco.languages.registerImplementationProvider(selector, providers.current);
    return () => { epoch.current++; defs.dispose(); impls.dispose(); replies.current.clear(); };
  }, []);
  runRef.current = async (binding, kind) => {
    if (!activeRef.current) return;
    const model = binding.editor.getModel(), pos = binding.editor.getPosition(); if (!model || !pos) return;
    const id = ++epoch.current; setMessage("이동할 코드를 찾는 중");
    try {
      if (kind === "definition") await providers.current.provideDefinition(model, pos); else await providers.current.provideImplementation(model, pos);
      const result = await resolve(model, pos, kind);
      if (id !== epoch.current || !activeRef.current || bindings.current.get(model.uri.toString()) !== binding) return;
      setMessage(null); chooseReply(result, binding.target, kind);
    } catch (e) { if (id === epoch.current) setMessage(e instanceof Error ? e.message : String(e)); }
  };
  const register = useCallback((binding: EditorBinding) => {
    const uri = binding.editor.getModel()!.uri.toString(); bindings.current.set(uri, binding);
    if (!focused.current || binding.editor.getDomNode()?.closest(".navigation-reader")) focused.current = binding;
    const subscriptions = [
      binding.editor.onDidFocusEditorText(() => { focused.current = binding; setSource(binding.target.source); epoch.current++; }),
      binding.editor.addAction({ id: "callpath.definition", label: "정의로 이동", keybindings: [monaco.KeyCode.F12], contextMenuGroupId: "navigation", contextMenuOrder: 1, run: () => runRef.current(binding, "definition") }),
      binding.editor.addAction({ id: "callpath.implementations", label: "구현체로 이동", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyB], contextMenuGroupId: "navigation", contextMenuOrder: 2, run: () => runRef.current(binding, "implementations") }),
      binding.editor.onMouseDown(e => {
        if (!(e.event.metaKey || e.event.ctrlKey) || !e.event.leftButton || !e.target.position || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
        const detail = e.target.detail as { injectedText?: unknown }; if (detail.injectedText) return;
        binding.editor.setPosition(e.target.position); e.event.preventDefault(); runRef.current(binding, "definition");
      }),
    ];
    return () => { subscriptions.forEach(s => s.dispose()); if (bindings.current.get(uri) === binding) bindings.current.delete(uri); if (focused.current === binding) focused.current = null; epoch.current++; };
  }, [scopeKey]);
  const followClass = async (path: string, name: string) => {
    const id = ++epoch.current, target = targetFor("code")!;
    try { const r = await ask(target, { kind: "search", query: name.split("@")[0]!, limit: 100000 }); if (id === epoch.current && activeRef.current) chooseReply({ items: r.items.filter(c => c.path === path), total: r.total }, target, "definition"); }
    catch (e) { if (id === epoch.current) setMessage(String(e)); }
  };
  const controller = useMemo<CodeNavigationController>(() => ({ target: targetFor, register, search, followClass, covered: !!place, canForward: cursor.current < history.current.length-1, forward:()=>move(1) }), [register, scopeKey, revision, active]);
  useEffect(() => { onCoveredChange(!!place); return () => onCoveredChange(false); }, [!!place]);
  useEffect(() => { if (!active) { epoch.current++; setSearching(false); setChoice(null); } }, [active]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "o") {
        if (document.querySelector("dialog[open]") && !dialog.current?.open) return;
        e.preventDefault(); if (!dialog.current?.open) search();
      } else if (!document.querySelector("dialog[open]") && e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); move(e.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true);
  }, [scopeKey]);
  const pickerOpen = searching || !!choice;
  useEffect(() => { const d=dialog.current;if(!d)return;if (pickerOpen && !d.open) { d.showModal(); requestAnimationFrame(() => input.current?.focus()); } else if (!pickerOpen && d.open) d.close(); }, [pickerOpen]);
  useEffect(() => {
    if (!searching || !target) return;
    let alive = true; setLoading(true); setPickerError(null); setSelection(0);
    const timer = setTimeout(() => { void ask(target, {kind:"search",query,limit}).then(r => { if (alive) { setResult(r); setResultKey(searchKey); setLoading(false); } }, e => { if (alive) { setResult(empty); setResultKey(searchKey); setPickerError(String(e.message ?? e)); setLoading(false); } }); }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [searching, searchKey]);
  const isLoading = loading || searching && resultKey !== searchKey;
  const shown = choice ? choice.items.filter(c => `${c.name} ${c.qualifiedName} ${c.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : resultKey === searchKey ? result.items : [];
  const pick = async (c: NavigationClass) => {
    if (choice?.chooseType) {
      const id = ++epoch.current; setLoading(true);
      try { const r = await ask(choice.target, {kind:"implementors",id:c.id}); if (id === epoch.current) { setLoading(false); if (!r.items.length) setPickerError("현재 범위에 확인된 구현체가 없습니다. 다른 타입을 선택하려면 검색어를 바꾸세요."); else chooseReply(r,choice.target,"implementations"); } }
      catch (e) { if (id === epoch.current) { setLoading(false); setPickerError(String(e)); } }
    } else if (pickerTarget) open(c, pickerTarget);
  };
  useEffect(() => { document.getElementById(`${listId}-${selection}`)?.scrollIntoView({block:"nearest"}); }, [selection]);
  return <CodeNavigationContext.Provider value={controller}>
    <div className="class-navigation">
      <div className="navigation-base" inert={!!place} aria-hidden={place ? true : undefined} style={place ? {visibility:"hidden"} : undefined}>{children}</div>
      {place && <section className="navigation-reader" aria-label="클래스 코드 탐색" data-testid="navigation-reader">
        <header className="toolbar"><span className="brand">Callpath</span><span className="refs">{place.target.label}@{place.target.sha.slice(0,7)}</span><span className="spacer"/><ClassSearchButton/><button onClick={() => move(-cursor.current)}>원래 보기로</button></header>
        <div className="detail-head navigation-title"><div className="title-row"><button aria-label="이전 코드 위치" disabled={!cursor.current} onClick={()=>move(-1)}>←</button><button aria-label="다음 코드 위치" disabled={cursor.current===history.current.length-1} onClick={()=>move(1)}>→</button><h2>{place.symbol.name}</h2><span className="chip">{KIND_LABEL[place.symbol.kind]}{place.symbol.abstract&&place.symbol.kind!=="interface"?", 추상":""}</span></div><p className="muted path">{place.symbol.path}</p>
          <div className="row wrap navigation-actions"><button onClick={()=>focused.current&&runRef.current(focused.current,"definition")}>정의로 이동 <kbd>F12</kbd></button><button onClick={()=>focused.current&&runRef.current(focused.current,"implementations")}>구현체로 이동</button><ParentTypes place={place} ask={ask} onOpen={open}/></div>
        </div>
        <NavigationReader key={place.serial} place={place} settings={settings} active={active} onSettings={onSettings}/>
      </section>}
      {message && <div className="navigation-message" role="status"><span>{message}</span><button className="link" onClick={()=>setMessage(null)} aria-label="탐색 안내 닫기">닫기</button></div>}
      <dialog ref={dialog} className="class-picker" aria-labelledby={`${listId}-title`} onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>{
        if (e.target instanceof HTMLSelectElement) return;
        if (e.key==="ArrowDown"||e.key==="ArrowUp") { e.preventDefault();const next=Math.max(0,Math.min(shown.length-1,selection+(e.key==="ArrowDown"?1:-1)));setSelection(next);if((e.target as HTMLElement).getAttribute("role")==="option")requestAnimationFrame(()=>document.getElementById(`${listId}-${next}`)?.focus()); }
        if(e.key==="Enter"&&(e.target===input.current||(e.target as HTMLElement).getAttribute("role")==="option")&&shown[selection]&&!isLoading){e.preventDefault();void pick(shown[selection]!);}
      }}>
        <div className="class-picker-head"><h2 id={`${listId}-title`}>{choice?.title??"클래스 검색"}</h2><button onClick={close} aria-label="클래스 검색 닫기">×</button></div>
        <div className="class-picker-scope">{!choice&&targets.length>1?<select aria-label="검색할 코드 시점" value={target?.source} onChange={e=>{setSource(e.target.value as NavigationScope["source"]);setLimit(100);}}>{targets.map(t=><option key={t.source} value={t.source}>{t.label}@{t.sha.slice(0,7)}</option>)}</select>:<span>{pickerTarget?`${pickerTarget.label}@${pickerTarget.sha.slice(0,7)}`:"분석 대기"}</span>}<span>{pickerTarget?.dir??"저장소 전체"}</span></div>
        <input ref={input} role="combobox" aria-expanded={pickerOpen} aria-autocomplete="list" aria-label="클래스 이름, 패키지 또는 경로" placeholder="클래스 이름, 패키지 또는 경로" value={query} onChange={e=>{epoch.current++;setLoading(false);setPickerError(null);setQuery(e.target.value);setSelection(0);setLimit(100);}} aria-controls={listId} aria-activedescendant={shown.length?`${listId}-${selection}`:undefined} autoComplete="off"/>
        <div className="class-picker-results" id={listId} role="listbox" aria-label="클래스 목록" aria-busy={!!target&&isLoading}>
          {!target?<p className="placeholder" role="status">{pendingMessage??"저장소를 분석하는 중입니다. 완료되면 입력한 이름으로 찾습니다."}</p>:isLoading?<p className="placeholder" role="status">클래스를 찾는 중</p>:pickerError?<p className="placeholder error-text" role="alert">{pickerError}</p>:!shown.length?<p className="placeholder">일치하는 클래스가 없습니다</p>:shown.map((c,i)=><button key={c.id} id={`${listId}-${i}`} role="option" tabIndex={selection===i?0:-1} aria-selected={selection===i} className={`class-picker-result${selection===i?" selected":""}`} onClick={()=>void pick(c)} onFocus={()=>setSelection(i)}><span><strong>{c.name}</strong><span className="chip">{KIND_LABEL[c.kind]}{c.abstract&&c.kind!=="interface"?", 추상":""}{c.test?", 테스트":""}</span></span><small>{c.packageName||"기본 패키지"}</small><small>{c.path}:{c.namePos.line+1}</small></button>)}
          {!choice&&!isLoading&&result.total>result.items.length&&<button onClick={()=>setLimit(n=>n+100)}>100개 더 보기</button>}
        </div>
        <footer><span>↑ ↓ 선택　Enter 열기　Esc 취소</span><span>{!target?"분석 대기":isLoading?"찾는 중":`${choice?shown.length:result.total}개${!choice&&result.total>result.items.length?`, ${result.items.length}개 표시`:""}`}</span></footer>
      </dialog>
    </div>
  </CodeNavigationContext.Provider>;
}

function ParentTypes({place,ask,onOpen}:{place:Place;ask:(t:NavigationScope,q:NavigationQuery)=>Promise<NavigationReply>;onOpen:(c:NavigationClass,t:NavigationScope)=>void}) {
  const [parents,setParents]=useState<NavigationClass[]>([]);
  useEffect(()=>{let alive=true;void ask(place.target,{kind:"parents",id:place.symbol.id}).then(r=>{if(alive)setParents(r.items);},()=>{});return()=>{alive=false;};},[place.serial]);
  return <>{parents.map(c=><button className="link small" key={c.id} onClick={()=>onOpen(c,place.target)}>상위 타입: {c.name}</button>)}{place.symbol.unresolvedParents.length>0&&<span className="muted small" title={place.symbol.unresolvedParents.join(", ")}>소스를 확인하지 못한 상위 타입 {place.symbol.unresolvedParents.length}개</span>}</>;
}
function NavigationReader({place,settings,active,onSettings}:{place:Place;settings:LlmSettingsView|null;active:boolean;onSettings:()=>void}) {
  const [text,setText]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{let alive=true;void window.callpath.readFile({repo:place.target.repo,ref:place.target.sha,path:place.symbol.path}).then(r=>{if(!alive)return;if(!r.ok)setError(r.error);else if(r.value===null)setError("이 커밋에 파일이 없습니다.");else setText(r.value);});return()=>{alive=false;};},[place.serial]);
  if(error)return <p className="placeholder error-text" role="alert">{error}</p>;
  if(text===null)return <p className="placeholder" role="status">코드를 읽는 중</p>;
  return <div className="diff-wrap"><AutomaticReading request={{kind:"code",repo:place.target.repo,sources:[{id:"code",ref:place.target.sha,path:place.symbol.path,from:place.symbol.range.startLine+1,to:text.split("\n").length}]}} settings={settings} active={active} onSettings={onSettings}>{(visible,register)=><CodeView text={text} language={languageFor(place.symbol.path)} firstLine={1} reveal={place.symbol.namePos.line+1} revealColumn={place.symbol.namePos.column+1} highlight={{from:place.symbol.namePos.line+1,to:place.symbol.namePos.line+1}} marks={[]} label={`${place.symbol.name} 탐색 코드`} onEditor={register} onVisibleLine={line=>visible("code",line)} navigation={{path:place.symbol.path,source:place.target.source}} initialState={place.state} autoFocus/>}</AutomaticReading></div>;
}
