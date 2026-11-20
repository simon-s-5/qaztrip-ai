"use client";

import { useI18n } from "./LanguageProvider";
import { Icon } from "./Icon";

/** Label shown next to every AI-generated answer. */
export function AiBadge({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <p className="inline-flex items-start gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent">
      <Icon name="spark" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{text ?? t("common.aiBadge")}</span>
    </p>
  );
}

export function UnverifiedTag() {
  const { t } = useI18n();
  return (
    <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn-ink">
      {t("common.unverified")}
    </span>
  );
}
