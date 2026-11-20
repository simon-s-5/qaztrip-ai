"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { useI18n } from "@/components/LanguageProvider";

/** Shown instead of a broken page if rendering fails; header and navigation stay usable. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="card mx-auto mt-8 max-w-md space-y-3 p-5 text-center">
      <p className="font-semibold">{t("errors.crash")}</p>
      <button type="button" className="btn-primary" onClick={() => retry()}>
        {t("common.retry")}
      </button>
    </div>
  );
}
