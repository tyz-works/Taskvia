// src/app/missions/[slug]/page.tsx
import { notFound } from "next/navigation";
import { fetchMission, fetchMissionTasks, fetchWorkers } from "@/app/actions";
import MissionDetail from "@/components/MissionDetail";

export default async function MissionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [mission, tasks, workers] = await Promise.all([
    fetchMission(slug),
    fetchMissionTasks(slug),
    fetchWorkers(),
  ]);

  if (!mission) notFound();

  return <MissionDetail mission={mission} initialTasks={tasks} workers={workers} />;
}
