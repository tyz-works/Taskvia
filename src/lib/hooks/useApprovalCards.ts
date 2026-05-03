"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchApprovalCards,
  cleanupOrphanCards,
  type ApprovalCard,
} from "@/app/actions";
import { usePolling } from "@/lib/usePolling";

const POLL_ACTIVE_MS = 5000;

export function useApprovalCards(onToast: (msg: string) => void) {
  const [approvalCards, setApprovalCards] = useState<ApprovalCard[]>([]);
  const [approvalProjectFilter, setApprovalProjectFilter] = useState<string | null>(null);
  const [activeApproval, setActiveApproval] = useState<ApprovalCard | null>(null);
  const knownApprovalIds = useRef<Set<string>>(new Set());
  const initialApprovalLoad = useRef(true);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const fetchApprovals = useCallback(async () => {
    const data = await fetchApprovalCards();
    const pending = data.filter((c) => c.status === "pending");
    setApprovalCards(pending);

    if (initialApprovalLoad.current) {
      initialApprovalLoad.current = false;
      for (const c of pending) knownApprovalIds.current.add(c.id);
      if (pending.length > 0) setActiveApproval(pending[0]);
      return;
    }

    const newCards = pending.filter((c) => !knownApprovalIds.current.has(c.id));
    for (const c of pending) knownApprovalIds.current.add(c.id);

    if (newCards.length > 0) {
      setActiveApproval((current) => current ?? newCards[0]);

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        const card = newCards[0];
        const n = new Notification(`承認要求 — ${card.agent}`, {
          body: card.tool,
          tag: "crewvia-approval",
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }
  }, []);

  usePolling(fetchApprovals, POLL_ACTIVE_MS);

  const handleApprovalDone = useCallback((action: "approved" | "denied") => {
    setActiveApproval((current) => {
      const remaining = approvalCards
        .filter((c) => c.id !== current?.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return remaining.length > 0 ? remaining[0] : null;
    });
    onToast(action === "approved" ? "✅ 承認しました" : "❌ 拒否しました");
    fetchApprovals();
  }, [approvalCards, fetchApprovals, onToast]);

  const handleApprovalDeleted = useCallback(() => {
    setActiveApproval((current) => {
      const remaining = approvalCards
        .filter((c) => c.id !== current?.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return remaining.length > 0 ? remaining[0] : null;
    });
    onToast("🗑 カードを削除しました");
    fetchApprovals();
  }, [approvalCards, fetchApprovals, onToast]);

  const handleCleanup = useCallback(async () => {
    const result = await cleanupOrphanCards();
    onToast(
      result.cleaned > 0
        ? `🧹 孤児カード ${result.cleaned}件を掃除しました`
        : "孤児カードはありませんでした"
    );
    fetchApprovals();
  }, [fetchApprovals, onToast]);

  const filteredApprovalCards = approvalProjectFilter
    ? approvalCards.filter((c) => c.project === approvalProjectFilter)
    : approvalCards;
  const approvalProjects = [...new Set(approvalCards.map((c) => c.project))].sort();

  return {
    approvalCards,
    filteredApprovalCards,
    approvalProjects,
    approvalProjectFilter,
    setApprovalProjectFilter,
    activeApproval,
    setActiveApproval,
    pendingApprovalCount: filteredApprovalCards.length,
    handleApprovalDone,
    handleApprovalDeleted,
    handleCleanup,
  };
}
