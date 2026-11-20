"use client";

import { useI18n } from "./LanguageProvider";
import { Icon } from "./Icon";
import { UnverifiedTag } from "./AiBadge";
import { Usd } from "./Usd";
import type { Driver } from "@/lib/drivers";
import type { RoadState, RoadStatus } from "@/lib/places";
import type { DictKey } from "@/lib/dictionaries";

const ROAD_STYLE: Record<RoadState, string> = {
  open: "bg-brand-soft text-brand",
  limited: "bg-warn-soft text-warn-ink",
  closed: "bg-danger-soft text-danger-ink",
};

/** Small "Road open / Limited access / Road closed" badge. */
export function RoadBadge({ status }: { status: RoadState }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${ROAD_STYLE[status]}`}>
      <Icon name={status === "open" ? "check" : "alert"} className="h-3 w-3" />
      {t(`road.${status}` as DictKey)}
    </span>
  );
}

/** Road status with its note, date and source (the note is translated with the place texts). */
export function RoadInfo({ road, note }: { road: RoadStatus; note: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <RoadBadge status={road.status} />
        {!road.verified && <UnverifiedTag />}
      </p>
      <p className="text-muted">{note || road.note}</p>
      <p className="text-xs text-muted">
        {t("road.checked", { date: road.lastChecked })} · {t("places.source")}: {road.source}
      </p>
    </div>
  );
}

/** Clear label for made-up driver profiles. */
export function DemoTag() {
  const { t } = useI18n();
  return (
    <span className="rounded-md border border-dashed border-accent px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
      {t("drivers.demo")}
    </span>
  );
}

function languageNames(codes: string[], locale: string) {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, "en"], { type: "language" });
  } catch {
    /* old browser: show codes */
  }
  return codes.map((c) => names?.of(c) ?? c).join(", ");
}

export function DriverCard({ driver }: { driver: Driver }) {
  const { t, formatKzt, locale } = useI18n();
  const p = driver.pricePerTrip;
  return (
    <li className="space-y-1 rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{driver.name}</span>
        {driver.isDemo && <DemoTag />}
        {!driver.verified && <UnverifiedTag />}
      </div>
      <p className="flex items-center gap-1.5 text-muted">
        <Icon name="car" className="h-4 w-4 shrink-0" />
        {t(`vehicle.${driver.vehicleType}` as DictKey)} · {t("drivers.seats", { n: driver.seats })}
      </p>
      <p className="text-muted">
        {t("drivers.languages")}: {languageNames(driver.languages, locale)}
      </p>
      <p>
        <span className="font-semibold tabular-nums">
          {formatKzt(p.min)} – {formatKzt(p.max)}
          <Usd min={p.min} max={p.max} />
        </span>{" "}
        <span className="text-xs text-muted">{t("drivers.perDay")}</span>
      </p>
    </li>
  );
}

export function DriverList({ drivers }: { drivers: Driver[] }) {
  const { t } = useI18n();
  if (drivers.length === 0) return <p className="text-sm text-muted">{t("drivers.none")}</p>;
  return (
    <div className="space-y-2">
      <ul className="grid gap-2 sm:grid-cols-2">
        {drivers.map((d) => (
          <DriverCard key={d.id} driver={d} />
        ))}
      </ul>
      {drivers.some((d) => d.isDemo) && <p className="text-xs text-muted">{t("drivers.demoNote")}</p>}
    </div>
  );
}
