"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  Send,
  User,
  Bot,
  Sparkles,
  BookOpen,
  Copy,
  Check,
  Loader2,
  GraduationCap,
  Building2,
  HelpCircle,
  Brain,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";

export type SuggestionIconKey = "graduation" | "book" | "building" | "help" | "brain";

export interface Suggestion {
  icon: SuggestionIconKey;
  q: string;
}

const ICON_MAP: Record<SuggestionIconKey, React.ComponentType<{ className?: string }>> = {
  graduation: GraduationCap,
  book: BookOpen,
  building: Building2,
  help: HelpCircle,
  brain: Brain,
};

interface SourceItem {
  docId: number;
  title: string;
  snippet: string;
  category?: string;
  sourceUrl?: string | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: SourceItem[];
  providerLabel?: string;
  isError?: boolean;
  timestamp: string;
}

interface AIStatusInfo {
  provider: string;
  model: string;
  label: string;
  activeDocumentsCount: number;
}

function getFallbackAuthHeaders(): Record<string, string> {
  try {
    const url = new URL(window.location.href);
    const st = url.searchParams.get("_st") || sessionStorage.getItem("aircampus_token");
    if (st) {
      return { Authorization: `Bearer ${st}` };
    }
  } catch {
    // Ignore
  }
  return {};
}

function renderInlineMarkdown(text: string): ReactNode[] {
  // Tokenize bold (**...**), inline code (`...`), italic (_..._ or *...*), and URLs (https://...)
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  const parts = text.split(pattern);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-navy-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-navy-100/80 text-navy-900 font-mono text-xs"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-navy-600 underline hover:text-navy-800 inline-flex items-center gap-0.5 break-all"
        >
          {part}
          <ExternalLink className="h-3 w-3 inline" />
        </a>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function FormattedMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          return <div key={idx} className="h-1.5" />;
        }
        if (line.trim() === "---") {
          return <hr key={idx} className="my-2 border-slate-200" />;
        }
        if (line.startsWith("#### ")) {
          return (
            <h4 key={idx} className="font-semibold text-navy-950 text-xs uppercase tracking-wider pt-1">
              {renderInlineMarkdown(line.slice(5))}
            </h4>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={idx} className="font-bold text-navy-950 text-base pt-1">
              {renderInlineMarkdown(line.slice(4))}
            </h3>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={idx} className="font-bold text-navy-950 text-base pt-1">
              {renderInlineMarkdown(line.slice(3))}
            </h3>
          );
        }
        if (line.startsWith("_") && line.endsWith("_") && line.length > 2) {
          return (
            <p key={idx} className="text-xs italic text-slate-500 pt-1">
              {line.slice(1, -1)}
            </p>
          );
        }
        if (/^\s*[-*]\s+/.test(line)) {
          const textBody = line.replace(/^\s*[-*]\s+/, "");
          const isIndented = /^\s{2,}/.test(line);
          return (
            <div key={idx} className={`flex items-start gap-2 ${isIndented ? "pl-4" : ""}`}>
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-600 flex-shrink-0" />
              <div className="flex-1">{renderInlineMarkdown(textBody)}</div>
            </div>
          );
        }
        const numMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="font-semibold text-navy-700 min-w-[1.25rem]">{numMatch[1]}.</span>
              <div className="flex-1">{renderInlineMarkdown(numMatch[2])}</div>
            </div>
          );
        }
        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

export function AIChatClient({
  suggestions,
  module = "assistant",
  assistantTitle = "AI Campus Assistant",
}: {
  suggestions: Suggestion[];
  module?: "assistant" | "teaching_assistant";
  assistantTitle?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusInfo, setStatusInfo] = useState<AIStatusInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const res = await fetch("/api/ai/status", {
          credentials: "include",
          cache: "no-store",
          headers: { ...getFallbackAuthHeaders() },
        });
        if (res.ok && active) {
          const data = await res.json();
          setStatusInfo(data);
        }
      } catch {
        // Non-critical
      }
    }
    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const query = text.trim();
    if (!query || loading) return;

    const historyForApi = messages
      .filter((m) => !m.isError)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: query,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...getFallbackAuthHeaders(),
        },
        body: JSON.stringify({
          query,
          module,
          history: historyForApi,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              data.error ||
              `Request failed with status ${res.status}. Please refresh the page and try again.`,
            isError: true,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || "No response received from AI engine.",
          sources: data.sources || [],
          providerLabel: data.provider,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Network error reaching `/api/ai/chat`. Please check your connection and try again.",
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string, id: number) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <Card padding="none" className="flex flex-col h-[calc(100vh-220px)] min-h-[540px]">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-navy-700 to-cyan-600 text-white flex items-center justify-center">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-navy-950 text-sm flex items-center gap-2">
              {assistantTitle}
              {statusInfo && (
                <Badge variant="info">
                  {statusInfo.label} · {statusInfo.activeDocumentsCount} Docs
                </Badge>
              )}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Grounded in verified Air University Karachi knowledge & live campus records
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-navy-900"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-navy-600 to-cyan-600 text-white flex items-center justify-center mb-4 shadow-md">
              <Sparkles className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-semibold text-navy-950">How can I help you today?</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md">
              {module === "teaching_assistant"
                ? "Generate quiz drafts, lesson plans, assignment outlines, or query university academic guides."
                : "Ask in English or Roman Urdu about Air University Karachi programs, facilities, complaints, events, or your enrolled courses."}
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-2.5 w-full max-w-2xl">
              {suggestions.map((s) => {
                const IconComp = ICON_MAP[s.icon] || Sparkles;
                return (
                  <button
                    key={s.q}
                    type="button"
                    onClick={() => send(s.q)}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-200 hover:border-navy-300 hover:bg-slate-50 text-left text-sm text-navy-800 transition-colors"
                  >
                    <IconComp className="h-4 w-4 text-navy-600 flex-shrink-0" />
                    <span className="line-clamp-2">{s.q}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`h-8 w-8 rounded-lg flex-shrink-0 flex items-center justify-center ${
                  m.role === "user"
                    ? "bg-navy-900 text-white"
                    : "bg-gradient-to-br from-navy-700 to-cyan-600 text-white"
                }`}
              >
                {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div className={`flex-1 max-w-[86%] ${m.role === "user" ? "text-right" : ""}`}>
                <div
                  className={`inline-block text-left rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-navy-900 text-white rounded-tr-sm"
                      : m.isError
                      ? "bg-red-50 text-red-800 ring-1 ring-red-200 rounded-tl-sm"
                      : "bg-slate-50 text-navy-900 ring-1 ring-slate-200 rounded-tl-sm"
                  }`}
                >
                  {m.role === "user" ? (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  ) : (
                    <FormattedMarkdown content={m.content} />
                  )}

                  {m.role === "assistant" && !m.isError && (
                    <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex items-center justify-between gap-4">
                      <span className="text-[10px] text-slate-400">{m.timestamp}</span>
                      <button
                        type="button"
                        onClick={() => copyText(m.content, i)}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-navy-700"
                      >
                        {copiedId === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedId === i ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>

                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <BookOpen className="h-3 w-3" /> Verified Sources ({m.sources.length})
                    </div>
                    <div className="grid sm:grid-cols-2 gap-1.5">
                      {m.sources.map((s) => (
                        <div
                          key={s.docId}
                          className="rounded-lg bg-white ring-1 ring-slate-200 p-2.5 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-navy-800 line-clamp-1">
                              {s.title}
                            </div>
                            {s.sourceUrl && (
                              <a
                                href={s.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-navy-600 hover:text-navy-800 flex-shrink-0"
                                title="Official source"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                            {s.snippet}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-navy-700 to-cyan-600 text-white flex items-center justify-center">
              <Bot className="h-4 w-4" />
            </div>
            <div className="bg-slate-50 ring-1 ring-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Retrieving verified campus knowledge...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              module === "teaching_assistant"
                ? "Ask to generate a quiz, lesson plan, lab outline, or search policies..."
                : "Ask about AU Karachi programs, library, complaints, or 'What are my courses?'..."
            }
            className="flex-1 h-11 px-4 rounded-lg bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-navy-200 border border-transparent focus:border-navy-300"
            disabled={loading}
          />
          <Button type="submit" disabled={!input.trim() || loading} className="h-11 px-4" aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <div className="mt-2 text-[11px] text-slate-500 text-center">
          Responses are grounded in the university knowledge base & live database. Configure external LLM keys in <code>.env</code> anytime.
        </div>
      </div>
    </Card>
  );
}
