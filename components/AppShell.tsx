"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import { Icon } from "./Icon";
import type { DictKey } from "@/lib/dictionaries";

const NAV: { href: string; key: DictKey; icon: string }[] = [
  { href: "/", key: "nav.home", icon: "home" },
  { href: "/planner", key: "nav.planner", icon: "route" },
  { href: "/places", key: "nav.places", icon: "pin" },
  { href: "/chat", key: "nav.chat", icon: "chat" },
  { href: "/how-ai-works", key: "nav.about", icon: "spark" },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, language, status, aiTranslated, setLanguage } = useI18n();
  const path = usePathname();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink">
              <Icon name="route" className="h-4.5 w-4.5" />
            </span>
            <span>{t("appName")}</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.slice(1).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  isActive(path, n.href) ? "bg-brand-soft font-semibold text-brand" : "text-muted hover:text-ink"
                }`}
              >
                {t(n.key)}
              </Link>
            ))}
          </nav>
          <Link
            href="/#language"
            className="chip shrink-0"
            aria-label={t("lang.button")}
          >
            <Icon name="globe" className="h-4 w-4" />
            <span className="max-w-24 truncate">{language.native}</span>
            {aiTranslated && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent"
                title={t("common.aiTranslated")}
              >
                <Icon name="spark" className="h-3 w-3" />
                {t("common.aiTranslated")}
              </span>
            )}
          </Link>
        </div>
        {status === "translating" && (
          <div className="flex items-center justify-center gap-2 bg-brand-soft px-4 py-1.5 text-xs font-medium text-brand">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
            {t("home.translating")}
          </div>
        )}
        {status === "error" && (
          <div role="status" className="bg-danger-soft px-4 py-1.5 text-center text-xs text-danger-ink">
            {t("errors.translate")}{" "}
            <button type="button" className="font-semibold underline" onClick={() => setLanguage(language)}>
              {t("common.retry")}
            </button>
          </div>
        )}
      </header>

      <main className="pb-nav mx-auto w-full max-w-3xl flex-1 px-4 pt-5 md:pb-10">{children}</main>

      <footer className="hidden pb-6 text-center text-xs text-muted md:block">{t("footer")}</footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                    active ? "font-semibold text-brand" : "text-muted"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={n.icon} className="h-5 w-5" />
                  <span className="max-w-full truncate px-1">{t(n.key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
