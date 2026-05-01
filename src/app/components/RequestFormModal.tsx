"use client";

import { useState } from "react";
import { submitRequest } from "../actions";
import { PRIORITY_BADGE } from "./constants";

const ALL_SKILLS = [
  "ops", "bash", "code", "python", "typescript",
  "research", "database", "cloud", "docs", "review",
];

export function RequestFormModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [skills, setSkills] = useState<string[]>([]);
  const [targetDir, setTargetDir] = useState("");
  const [deadlineNote, setDeadlineNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSkill = (skill: string) =>
    setSkills((prev) => prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]);

  const handleSubmit = async () => {
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    if (!body.trim()) { setError("依頼内容を入力してください"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitRequest({
        title: title.trim(), body: body.trim(), priority,
        skills, target_dir: targetDir.trim(), deadline_note: deadlineNote.trim(),
      });
      if ("error" in result) { setError(result.error); return; }
      onSubmitted(result.id);
    } catch {
      setError("ネットワークエラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-white font-semibold text-base">Director に依頼</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">タイトル <span className="text-red-400">*</span></div>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="例: ログビューアにフィルタ機能を追加"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">依頼内容 <span className="text-red-400">*</span></div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="詳細な依頼内容を記載してください" rows={4}
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600 resize-none" />
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">優先度</div>
            <div className="flex gap-2">
              {(["high", "medium", "low"] as const).map((p) => (
                <button key={p} onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${priority === p ? PRIORITY_BADGE[p] : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">スキル</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SKILLS.map((skill) => (
                <button key={skill} onClick={() => toggleSkill(skill)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${skills.includes(skill) ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"}`}>
                  {skill}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">target_dir（任意）</div>
            <input value={targetDir} onChange={(e) => setTargetDir(e.target.value)}
              placeholder="/Users/tyz/workspace/..."
              className="w-full bg-transparent text-sm text-zinc-400 outline-none placeholder:text-zinc-600 font-mono" />
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">締切メモ（任意）</div>
            <input value={deadlineNote} onChange={(e) => setDeadlineNote(e.target.value)}
              placeholder="例: 今週中に"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button onClick={onClose}
              className="py-3 rounded-xl bg-zinc-700/50 border border-zinc-600 text-zinc-400 font-semibold hover:bg-zinc-700 active:scale-95 transition-all">
              キャンセル
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? "送信中..." : "依頼を送信"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
