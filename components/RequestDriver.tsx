"use client";

import { useState } from "react";
import { useI18n } from "./LanguageProvider";
import { Icon } from "./Icon";
import { requestMessage, whatsappLink, whatsappNumber, type RequestDay } from "@/lib/request";

/** Public business number, inlined at build time. Empty → the button is not shown. */
const NUMBER = whatsappNumber(process.env.NEXT_PUBLIC_REQUEST_WHATSAPP);

/**
 * "Request a driver": opens WhatsApp with a ready message about the route.
 * Nothing is sent to or stored by our server; the QazTrip team handles the request by hand.
 */
export function RequestDriver({
  title,
  days,
  totalDays,
  travellers,
}: {
  title: string;
  days: RequestDay[];
  totalDays: number;
  travellers: number;
}) {
  const { t, language } = useI18n();
  const [date, setDate] = useState("");
  if (!NUMBER) return null;

  const href = whatsappLink(
    NUMBER,
    requestMessage({ title, days, totalDays, travellers, language: language.name, date }),
  );

  return (
    <section className="card space-y-3 border-brand p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon name="car" className="h-5 w-5 text-brand" />
        {t("request.title")}
      </h3>
      <label className="block max-w-xs">
        <span className="mb-1 block text-xs text-muted">{t("request.date")}</span>
        <input type="date" className="input py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <a href={href} target="_blank" rel="noopener noreferrer" className="btn-primary w-full sm:w-auto">
        <Icon name="send" className="h-4 w-4" />
        {t("request.button")}
      </a>
      <p className="text-sm font-medium">{t("request.pilot")}</p>
      <p className="text-xs text-muted">{t("request.privacy")}</p>
    </section>
  );
}
