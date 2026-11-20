import { notFound } from "next/navigation";
import { getPlace, PLACES } from "@/lib/places";
import { PlaceDetail } from "./PlaceDetail";

export function generateStaticParams() {
  return PLACES.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: PageProps<"/places/[id]">) {
  const { id } = await params;
  const place = getPlace(id);
  return { title: place ? `${place.name} — Sapar AI` : "Sapar AI" };
}

export default async function PlacePage({ params }: PageProps<"/places/[id]">) {
  const { id } = await params;
  if (!getPlace(id)) notFound();
  return <PlaceDetail id={id} />;
}
