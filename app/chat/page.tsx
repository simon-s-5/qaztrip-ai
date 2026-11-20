"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { AiBadge } from "@/components/AiBadge";
import { Icon } from "@/components/Icon";
import { errorKey, postJson } from "@/lib/client";
import type { DictKey } from "@/lib/dictionaries";

type Source = { title: string; url: string };
type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; sources: Source[]; searched: boolean }
  | { role: "error"; key: DictKey };

export default function ChatPage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}

function Chat() {
  const { t, language } = useI18n();
  const params = useSearchParams();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Prefill from "Ask AI about this place".
  useEffect(() => {
    const q = params.get("q");
    if (q) setInput(q.slice(0, 200) + " — ");
  }, [params]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  /** Resends the last question after an error (removes the failed question and the error). */
  function retryLast() {
    const idx = messages.findLastIndex((m) => m.role === "user");
    if (idx < 0) return;
    const last = messages[idx] as Extract<Msg, { role: "user" }>;
    void send(last.content, messages.slice(0, idx));
  }

  async function send(text: string, base: Msg[] = messages) {
    const content = text.trim().slice(0, 2000);
    if (!content || loading) return;
    const next: Msg[] = [...base, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const history = next
        .filter((m): m is Exclude<Msg, { role: "error" }> => m.role !== "error")
        .map((m) => ({ role: m.role, content: m.content }));
      const data = await postJson<{ answer: string; sources: Source[]; searched: boolean }>("/api/chat", {
        language: language.name,
        messages: history.slice(-10),
      });
      setMessages((m) => [...m, { role: "assistant", content: data.answer, sources: data.sources, searched: data.searched }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", key: errorKey(e) }]);
    } finally {
      setLoading(false);
    }
  }

  const suggestions: DictKey[] = ["chat.suggest1", "chat.suggest2", "chat.suggest3"];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("chat.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("chat.subtitle")}</p>
        </div>
        {messages.length > 0 && (
          <button type="button" className="chip shrink-0" onClick={() => setMessages([])}>
            <Icon name="plus" className="h-4 w-4" />
            {t("chat.clear")}
          </button>
        )}
      </header>

      {messages.length === 0 && (
        <div className="flex flex-col gap-2">
          {suggestions.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => send(t(k))}
              className="card flex items-center gap-2 p-3 text-start text-sm hover:border-brand"
            >
              <Icon name="spark" className="h-4 w-4 shrink-0 text-accent" />
              {t(k)}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.role === "user" ? (
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-md bg-brand px-3.5 py-2.5 text-brand-ink">
                {m.content}
              </p>
            ) : m.role === "error" ? (
              <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger-ink">
                <span>{t(m.key)}</span>
                {i === messages.length - 1 && m.key !== "errors.noKey" && !loading && (
                  <button type="button" onClick={retryLast} className="font-semibold underline">
                    {t("common.retry")}
                  </button>
                )}
              </div>
            ) : (
              <div className="card max-w-[92%] space-y-2.5 rounded-es-md p-3.5">
                {m.searched && m.sources.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
                    <Icon name="globe" className="h-3.5 w-3.5" />
                    {t("chat.searched")}
                  </p>
                )}
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                {m.sources.length > 0 && (
                  <div className="border-t border-line pt-2">
                    <p className="mb-1 text-xs font-semibold text-muted">{t("chat.sources")}</p>
                    <ol className="space-y-1 text-sm">
                      {m.sources.map((s, j) => (
                        <li key={s.url} className="flex gap-1.5">
                          <span className="text-muted tabular-nums">[{j + 1}]</span>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="line-clamp-1 break-all text-brand underline"
                          >
                            {s.title || new URL(s.url).hostname}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <AiBadge />
              </div>
            )}
          </li>
        ))}
        {loading && (
          <li className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
            {t("chat.thinking")}
          </li>
        )}
      </ul>
      <div ref={bottom} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex gap-2 rounded-2xl border border-line bg-surface p-2 shadow-sm md:bottom-4"
      >
        <textarea
          className="input min-h-11 flex-1 resize-none border-0 py-2.5 shadow-none focus:shadow-none"
          rows={1}
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
        />
        <button type="submit" className="btn-primary shrink-0 px-3.5" disabled={loading || !input.trim()} aria-label={t("chat.send")}>
          <Icon name="send" className="h-5 w-5 rtl:-scale-x-100" />
        </button>
      </form>
      <p className="-mt-2 text-center text-xs text-muted">{t("chat.privacy")}</p>
    </div>
  );
}
