"use client";

import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";
import { LanguagePicker } from "@/components/LanguagePicker";
import { Icon } from "@/components/Icon";
import { PLACES } from "@/lib/places";
import type { DictKey } from "@/lib/dictionaries";

const FEATURES: { href: string; icon: string; title: DictKey; desc: DictKey }[] = [
  { href: "/planner", icon: "route", title: "home.feature.planner.title", desc: "home.feature.planner.desc" },
  { href: "/places", icon: "pin", title: "home.feature.places.title", desc: "home.feature.places.desc" },
  { href: "/chat", icon: "chat", title: "home.feature.chat.title", desc: "home.feature.chat.desc" },
  { href: "/how-ai-works", icon: "spark", title: "home.feature.about.title", desc: "home.feature.about.desc" },
];

export default function Home() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-brand px-5 pb-6 pt-7 text-brand-ink">
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full opacity-25"
          viewBox="0 0 400 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 100 L60 40 L95 70 L150 15 L210 75 L250 45 L300 85 L345 30 L400 70 L400 100 Z" fill="currentColor" />
        </svg>
        <p className="relative mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
          <Icon name="pin" className="h-3.5 w-3.5" />
          {t("home.region")}
        </p>
        <h1 className="relative text-2xl font-bold leading-tight sm:text-3xl">{t("home.title")}</h1>
        <p className="relative mt-2 max-w-md text-sm opacity-90 sm:text-base">{t("home.subtitle")}</p>
        <Link
          href="/planner"
          className="relative mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0f6b63]"
        >
          <Icon name="route" className="h-4 w-4" />
          {t("home.start")}
        </Link>
      </section>

      <LanguagePicker />

      <section className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link key={f.href} href={f.href} className="card flex gap-3 p-4 transition hover:border-brand">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon name={f.icon} />
            </span>
            <span>
              <span className="block font-semibold">{t(f.title)}</span>
              <span className="mt-0.5 block text-sm text-muted">{t(f.desc, { n: PLACES.length })}</span>
            </span>
          </Link>
        ))}
      </section>

      <p className="pb-2 text-center text-xs text-muted md:hidden">{t("footer")}</p>
    </div>
  );
}
