"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Message = { id: string; role: string; content: string };
type Log = { id: string; step_name: string; status: string; detail?: string | null };
type Approval = {
  id: string;
  tool_call_id: string;
  code_preview: string | null;
  status: string;
};

export default function DashboardPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
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
      setApprovals([]);
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

    const { data: approvalData } = await supabaseBrowser
      .from("approvals")
      .select("id, tool_call_id, code_preview, status")
      .eq("thread_id", threadId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (approvalData) setApprovals(approvalData);
  }, []);

  const resolveApproval = async (toolCallId: string, approved: boolean) => {
    if (!currentThreadId) return;
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCallId,
          approved,
          threadId: currentThreadId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Approval failed");
      setApprovals((prev) => prev.filter((a) => a.tool_call_id !== toolCallId));
    } catch (e: any) {
      setError(e.message || "Could not resolve approval");
    }
  };

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
      {
        id: `init-${Date.now()}`,
        step_name: "task/received",
        status: "running",
      },
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
          className="text-xs text-primary hover:underline"
        >
          + New Thread
        </button>
      </header>

      {/* Timeline / Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && logs.length === 0 && (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center text-text-muted text-sm gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/10" />
            <p>Message the agent to start a Klaw run.</p>
            <p className="text-xs max-w-sm">
              Live Time-Travel steps appear below as Inngest writes agent_logs.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[70%] p-3 rounded-lg text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-white"
                  : "bg-surface border border-border"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Pending HITL approvals */}
        {approvals.map((a) => (
          <div
            key={a.id}
            className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm space-y-2"
          >
            <div className="font-medium text-amber-900">
              ⚠️ Approval required
            </div>
            <pre className="text-[11px] font-mono bg-white border border-amber-200 rounded p-2 overflow-x-auto max-h-40">
              {a.code_preview || "(no preview)"}
            </pre>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void resolveApproval(a.tool_call_id, true)}
                className="text-xs px-3 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => void resolveApproval(a.tool_call_id, false)}
                className="text-xs px-3 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                Deny
              </button>
            </div>
          </div>
        ))}

        {/* Agent Logs (Time-Travel Timeline) */}
        {logs.length > 0 && (
          <div className="border border-dashed border-border rounded-lg p-3 bg-background font-mono text-xs text-text-muted space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-text-muted/80 mb-1">
              Time-Travel
            </div>
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-2">
                <span
                  className={
                    log.status === "running"
                      ? "animate-pulse text-primary"
                      : log.status === "failed"
                        ? "text-red-500"
                        : "text-text-muted"
                  }
                >
                  {log.status === "running"
                    ? "●"
                    : log.status === "failed"
                      ? "✕"
                      : "○"}
                </span>
                <span>{log.step_name}</span>
                {log.detail && (
                  <span className="truncate opacity-60">— {log.detail}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
          {error}
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-surface shrink-0">
        <div className="flex items-center gap-2 border border-border rounded-lg p-2 bg-background">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSend();
            }}
            placeholder="Message the agent..."
            className="flex-1 bg-transparent outline-none text-sm px-2"
            disabled={sending || !currentThreadId}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !input.trim() || !currentThreadId}
            className="bg-primary text-white text-xs px-3 py-1 rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
