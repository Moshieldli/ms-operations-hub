import { TvTechsView } from "@/components/tv-techs-view";
import { getTechBoard } from "@/lib/service/tech-board";

// Reads mutable caches (respray_jobs + mosquito_service_status) that the nightly
// crons rewrite, so nothing here may be cached — otherwise Next pins an early
// empty read and the TV shows zeros forever (this bit /leads/followup).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function TvTechsPage() {
  const board = await getTechBoard();
  return <TvTechsView board={board} />;
}
