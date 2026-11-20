"use client";

import Link from "next/link";
import { usePlacesI18n } from "@/components/LanguageProvider";
import { UnverifiedTag } from "@/components/AiBadge";
import { Icon } from "@/components/Icon";
import { getPlace } from "@/lib/places";
import { driversForPlace } from "@/lib/drivers";
import { DriverList, RoadInfo } from "@/components/Drivers";

export function PlaceDetail({ id }: { id: string }) {
  const { t, placeText, placesTranslated, formatKzt } = usePlacesI18n();
  const place = getPlace(id)!;
  const tx = placeText(id);
  const { lat, lng } = place.coordinates;
  const mapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=12/${lat}/${lng}`;
  const askUrl = `/chat?q=${encodeURIComponent(tx.name)}`;
  const drivers = driversForPlace(id);

  return (
    <article className="space-y-4">
      <Link href="/places" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon name="back" className="h-4 w-4 rtl:-scale-x-100" />
        {t("places.back")}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold leading-tight">{tx.name}</h1>
        <p className="text-sm text-muted">
          {place.nameKk} · {tx.region}
        </p>
        {placesTranslated && (
          <p className="flex items-center gap-1.5 pt-1 text-xs text-muted">
            <Icon name="spark" className="h-3.5 w-3.5 text-accent" />
            {t("places.translatedNote")}
          </p>
        )}
      </header>

      <p className="card p-4 leading-relaxed">{tx.description}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Info icon="car" title={t("places.howToGet")} body={tx.howToGet} />
        <Info icon="sun" title={t("places.season")} body={tx.season} />
        <Info icon="clock" title={t("places.duration")} body={tx.durationHint} />
        <Info
          icon="map"
          title={t("places.coordinates")}
          body={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tabular-nums" dir="ltr">
                {lat.toFixed(4)}, {lng.toFixed(4)}
              </span>
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                {t("places.openMap")}
              </a>
            </span>
          }
        />
      </div>

      {place.roadStatus && (
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <Icon name="alert" className="h-5 w-5 text-accent" />
            {t("road.title")}
          </h2>
          <RoadInfo road={place.roadStatus} note={tx.roadNote} />
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Icon name="wallet" className="h-5 w-5 text-accent" />
          {t("places.prices")}
        </h2>
        {place.prices.length === 0 ? (
          <p className="text-sm text-muted">{t("places.noPrices")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {place.prices.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-muted">{tx.priceLabels[p.id] ?? p.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {p.max === 0 ? t("common.free") : `${formatKzt(p.min)} – ${formatKzt(p.max)}`}
                  </span>
                  {!p.verified && <UnverifiedTag />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(drivers.length > 0 || place.roadStatus) && (
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <Icon name="car" className="h-5 w-5 text-brand" />
            {t("drivers.title")}
          </h2>
          <DriverList drivers={drivers} />
        </section>
      )}

      <p className="flex items-center gap-1.5 text-sm text-muted">
        <Icon name="link" className="h-4 w-4" />
        {t("places.source")}:{" "}
        <a href={place.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">
          {place.sourceName}
        </a>
      </p>

      <div className="flex flex-wrap gap-2">
        <Link href={askUrl} className="btn-primary">
          <Icon name="chat" className="h-4 w-4" />
          {t("places.askChat")}
        </Link>
        <Link href="/planner" className="chip">
          <Icon name="route" className="h-4 w-4" />
          {t("home.start")}
        </Link>
      </div>
    </article>
  );
}

function Info({ icon, title, body }: { icon: string; title: string; body: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Icon name={icon} className="h-4.5 w-4.5 text-brand" />
        {title}
      </h2>
      <div className="text-sm text-muted">{body}</div>
    </div>
  );
}
