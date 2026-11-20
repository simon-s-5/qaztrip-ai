"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePlacesI18n } from "@/components/LanguageProvider";
import { Icon } from "@/components/Icon";
import { RoadBadge } from "@/components/Drivers";
import { Usd } from "@/components/Usd";
import { PLACES } from "@/lib/places";
import type { DictKey } from "@/lib/dictionaries";

const FILTERS = ["nature", "hiking", "city", "history", "culture", "winter", "family", "food", "relax"] as const;

export default function PlacesPage() {
  const { t, placeText, placesTranslated, formatKzt } = usePlacesI18n();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return PLACES.filter((p) => {
      if (cat && !p.categories.includes(cat)) return false;
      if (!query) return true;
      const tx = placeText(p.id);
      return [p.name, p.nameKk, tx.name, tx.description].some((s) => s.toLowerCase().includes(query));
    });
  }, [q, cat, placeText]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t("places.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("places.subtitle")}</p>
      </header>

      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
        <input
          className="input ps-10"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("places.search")}
          type="search"
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button type="button" className="chip shrink-0" aria-pressed={cat === null} onClick={() => setCat(null)}>
          {t("places.all")}
        </button>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="chip shrink-0"
            aria-pressed={cat === f}
            onClick={() => setCat(cat === f ? null : f)}
          >
            {t(`interest.${f}` as DictKey)}
          </button>
        ))}
      </div>

      {placesTranslated && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Icon name="spark" className="h-3.5 w-3.5 text-accent" />
          {t("places.translatedNote")}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((p) => {
          const tx = placeText(p.id);
          const paid = p.prices.filter((pr) => pr.max > 0);
          const minPrice = paid.length ? Math.min(...paid.map((pr) => pr.min)) : null;
          return (
            <li key={p.id}>
              <Link href={`/places/${p.id}`} className="card flex h-full flex-col gap-2 p-4 transition hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold leading-snug">{tx.name}</h2>
                  <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                    {p.distanceFromAlmatyKm > 0 ? t("places.distance", { n: p.distanceFromAlmatyKm }) : t("places.inCity")}
                  </span>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {p.nameKk}
                  {p.roadStatus && <RoadBadge status={p.roadStatus.status} />}
                </p>
                <p className="line-clamp-3 text-sm text-muted">{tx.description}</p>
                <p className="mt-auto flex items-center gap-1.5 pt-1 text-sm">
                  <Icon name="wallet" className="h-4 w-4 text-accent" />
                  {p.prices.length === 0 ? (
                    <span className="text-muted">{t("common.unknown")}</span>
                  ) : minPrice === null ? (
                    <span className="font-medium">{t("common.free")}</span>
                  ) : (
                    <span className="font-medium tabular-nums">
                      {formatKzt(minPrice)}+<Usd min={minPrice} /> <span className="text-xs font-normal text-warn-ink">· {t("common.unverified")}</span>
                    </span>
                  )}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p className="py-8 text-center text-sm text-muted">{t("places.empty")}</p>}
    </div>
  );
}
