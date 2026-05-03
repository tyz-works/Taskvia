"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import {
  fetchMissions as fetchMissionsAction,
  deleteMission,
  type Mission,
} from "@/app/actions";

export function useMissions(onToast: (msg: string) => void) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedMission, setSelectedMission] = useState<string | null>(null);

  useEffect(() => {
    fetchMissionsAction().then((data) => {
      setMissions(data);
      if (data.length > 0) {
        const firstActive = data.find((m) => m.status !== "done") ?? data[0];
        setSelectedMission(firstActive.slug);
      }
    });
  }, []);

  const handleDeleteMission = useCallback(async (slug: string) => {
    const mission = missions.find((m) => m.slug === slug);
    const label = mission ? mission.title : slug;
    if (!confirm(`ミッション「${label}」とその全タスクを削除しますか？\nこの操作は元に戻せません。`)) return;
    await deleteMission(slug);
    onToast(`🗑 ミッション「${label}」を削除しました`);
    const updated = await fetchMissionsAction();
    setMissions(updated);
    setSelectedMission(updated.length > 0 ? updated[0].slug : null);
  }, [missions, onToast]);

  return {
    missions,
    setMissions,
    selectedMission,
    setSelectedMission: setSelectedMission as Dispatch<SetStateAction<string | null>>,
    handleDeleteMission,
  };
}
