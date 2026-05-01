"use client";

import { useState, useCallback } from "react";
import { fetchAgents, type AgentStatus } from "@/app/actions";
import { usePolling } from "@/lib/usePolling";

const AGENT_POLL_MS = 5000;

export function useAgentStatus() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);

  const refresh = useCallback(async () => {
    const data = await fetchAgents();
    setAgents(data);
  }, []);

  usePolling(refresh, AGENT_POLL_MS);

  return { agents };
}
