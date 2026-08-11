"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Message = { id: string; role: string; content: string };
type Log = { id: string; step_name: string; status: string; detail?: string | null };

export default function DashboardPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [input, setInput] = useState("");
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createNewThread = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/threads", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create thread");
      setMessages([]);
      setLogs([]);
      setCurrentThreadId(json.id as string);
    } catch (e: any) {
      setError(e.message || "Could not create thread");
    }
  }, []);

  const fetchThreadData = useCallback(async (threadId: string) => {
    const { data: msgData } = await supabaseBrowser
      .from("messages")
      .select("id, role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (msgData) setMessages(msgData);

    const { data: logData } = await supabaseBrowser
      .from("agent_logs")
      .select("id, step_name, status, detail")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (logData) setLogs(logData);
  }, []);

  useEffect(() => {
    createNewThread();
  }, [createNewThread]);

  useEffect(() => {
    if (!currentThreadId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void fetchThreadData(currentThreadId);
    }, 1500);
    void fetchThreadData(currentThreadId);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [currentThreadId, fetchThreadData]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, logs]);

  const handleSend = async () => {
    if (!input.trim() || !currentThreadId || sending) return;
    const userMessage = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: userMessage },
    ]);
    setLogs((prev) => [
      ...prev,
      { id: `init-${Date.now()}`, step_name: "task/received", status: "running" },
    ]);

    try {
      const res = await fetch("/api/trigger-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: currentThreadId,
          message: userMessage,
          triggerSource: "web",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to trigger agent");
    } catch (e: any) {
      setError(e.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="h-12 border-b border-border flex items-center px-4 justify-between bg-surface shrink-0">
        <h2 className="text-sm font-medium font-mono">
          Thread:{" "}
          {currentThreadId
            ? `${currentThreadId.substring(0, 8)}…`
            : "New"}
        </h2>
        <button
          type="button"
          onClick={() => void createNewThread()}
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary-hover"
        >
          New thread
        </button>
      </header>

      {/* Timeline strip */}
      {logs.length > 0 && (
        <div className="border-b border-border bg-surface/80 px-4 py-2 flex gap-2 overflow-x-auto shrink-0">
          {logs.map((log) => (
            <span
              key={log.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono whitespace-nowrap ${
                log.status === "completed"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : log.status === "failed"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-border bg-background text-text-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  log.status === "completed"
                    ? "bg-emerald-500"
                    : log.status === "failed"
                      ? "bg-red-500"
                      : "bg-amber-400 animate-pulse"
                }`}
              />
              {log.step_name}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-text-muted text-sm gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/10" />
            <p>Send a message to start the Klaw agent.</p>
            <p className="text-xs max-w-sm">
              The agent can use the 32GB sandbox, skills, and dual-model routing.
              Timeline steps appear above as work runs.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-white"
                  : m.role === "assistant"
                    ? "bg-surface border border-border"
                    : "bg-background border border-border text-text-muted"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider opacity-70 mb-1">
                {m.role}
              </div>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
          {error}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border bg-surface p-3 shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={2}
            placeholder="Ask Klaw to analyze data, generate a PDF, review code…"
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            disabled={sending || !input.trim() || !currentThreadId}
            onClick={() => void handleSend()}
            className="self-end px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
