"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import {
  fetchMissions as fetchMissionsAction,
  fetchMissionTasks,
  fetchVerificationRecords,
  getVerificationUIEnabled,
  deleteMissionTask,
  type Mission,
  type Task,
  type VerificationRecord,
} from "@/app/actions";

const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 20000;

export function useTasks({
  selectedMission,
  setMissions,
  setSelectedMission,
  tab,
  onToast,
}: {
  selectedMission: string | null;
  setMissions: Dispatch<SetStateAction<Mission[]>>;
  setSelectedMission: Dispatch<SetStateAction<string | null>>;
  tab: "board" | "logs";
  onToast: (msg: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [verificationEnabled, setVerificationEnabled] = useState(true);
  const [verificationRecords, setVerificationRecords] = useState<Record<string, VerificationRecord>>({});

  useEffect(() => {
    getVerificationUIEnabled().then(setVerificationEnabled);
  }, []);

  const loadTasks = useCallback(async (): Promise<Task[]> => {
    if (!selectedMission) {
      const allMissions = await fetchMissionsAction();
      const results = await Promise.all(allMissions.map((m) => fetchMissionTasks(m.slug)));
      const merged = results.flat();
      setTasks(merged);
      setLoading(false);
      return merged;
    }
    const data = await fetchMissionTasks(selectedMission);
    setTasks(data);
    setLoading(false);
    return data;
  }, [selectedMission]);

  // Smart polling: adaptive interval + visibility awareness
  useEffect(() => {
    if (tab !== "board") return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;

      const updatedMissions = await fetchMissionsAction();
      if (!cancelled) {
        setMissions(updatedMissions);
        setSelectedMission((current) => {
          if (!current) return current;
          const found = updatedMissions.find((m) => m.slug === current);
          if (found && found.status !== "done") return current;
          const firstActive = updatedMissions.find((m) => m.status !== "done");
          return firstActive ? firstActive.slug : null;
        });
      }

      const latest = await loadTasks();
      if (cancelled) return;

      let vRecords: Record<string, VerificationRecord> = {};
      if (verificationEnabled && latest.length > 0) {
        vRecords = await fetchVerificationRecords(latest.map((t) => t.id));
        if (!cancelled) setVerificationRecords(vRecords);
      }

      const verificationActive = latest.some(
        (t) => t.status === "in_progress" && !vRecords[t.id]
      );
      const hasActive = latest.some((t) => t.status === "in_progress") || verificationActive;
      const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
      timer = setTimeout(tick, delay);
    };

    tick();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        tick();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTasks, tab, verificationEnabled, setMissions, setSelectedMission]);

  const handleDeleteTask = useCallback(async (slug: string, taskId: string) => {
    if (!confirm(`タスク "${taskId}" を削除しますか？`)) return;
    await deleteMissionTask(slug, taskId);
    onToast(`🗑 タスク ${taskId} を削除しました`);
    loadTasks();
  }, [loadTasks, onToast]);

  return {
    tasks,
    loading,
    verificationEnabled,
    verificationRecords,
    loadTasks,
    handleDeleteTask,
  };
}
