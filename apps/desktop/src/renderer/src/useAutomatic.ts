import { useEffect, useRef, useState } from "react";
import type { AutomaticRequest, AutomaticResult, LlmSettingsView } from "../../shared/api";
import type { ReadingNote } from "@callpath/llm";

export function useAutomatic(request: AutomaticRequest | null, settings: LlmSettingsView | null, active: boolean) {
  const [state, setState] = useState<{ key: string; status: "off" | "loading" | "ready" | "stopped" | "error"; notes: ReadingNote[]; info: Omit<AutomaticResult, "notes" | "cached"> | null; cached: boolean; error: string }>({ key: "", status: "off", notes: [], info: null, cached: false, error: "" });
  const [run, setRun] = useState(0);
  const stopCurrent = useRef<(() => void) | null>(null);
  const current = useRef<string | null>(null);
  const force = useRef(false);
  const signature = JSON.stringify(request);
  const enabled = !!(settings?.enabled && settings.endpoint.trim() && settings.model.trim());
  useEffect(() => {
    if (!active || !enabled || !request) { setState(s => ({ ...s, status: "off" })); return; }
    const id = crypto.randomUUID(); current.current = id;
    let alive = true;
    const forceThis = force.current; force.current = false;
    setState({ key: signature, status: "loading", notes: [], info: null, cached: false, error: "" });
    const off = window.callpath.onAutomaticEvent(ev => {
      if (!alive || ev.id !== id) return;
      if (ev.type === "scope") setState(s => ({ ...s, info: { scopes: ev.scopes, endpointHost: ev.endpointHost, model: ev.model } }));
      if (ev.type === "notes") setState(s => ({ ...s, notes: [...s.notes, ...ev.notes] }));
    });
    const timer = setTimeout(() => {
      void window.callpath.automaticExplain(request, id, forceThis).then(r => {
        if (!alive) return;
        if (r.ok) setState({ key: signature, status: "ready", notes: r.value.notes, info: r.value, cached: r.value.cached, error: "" });
        else setState(s => ({ ...s, status: r.kind === "cancelled" ? "stopped" : "error", error: r.error }));
      });
    }, 400);
    const stop = () => { alive = false; clearTimeout(timer); off(); void window.callpath.cancelAutomatic(id); if (current.current === id) current.current = null; };
    stopCurrent.current = stop;
    return () => { stop(); if (stopCurrent.current === stop) stopCurrent.current = null; };
  }, [signature, enabled, settings?.endpoint, settings?.model, active, run]);
  return { ...state, notes: state.key === signature ? state.notes : [], info: state.key === signature ? state.info : null,
    stop: () => { stopCurrent.current?.(); setState(s => ({ ...s, status: "stopped" })); },
    retry: () => { force.current = true; setRun(n => n + 1); },
  };
}
