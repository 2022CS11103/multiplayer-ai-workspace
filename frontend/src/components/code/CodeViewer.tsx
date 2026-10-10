"use client";

import { isLiveWorkspaceId } from "@/lib/api";
import { useStore } from "@/lib/store";
import CrdtEditor from "./CrdtEditor";
import FileTree from "./FileTree";

export default function CodeViewer() {
  const { state } = useStore();
  const file = state.files.find((item) => item.path === state.selectedFilePath) ?? state.files[0];
  const live = file ? isLiveWorkspaceId(state.activeWorkspaceId) : false;
  const watchers = (state.users || []).filter((user) => {
    const viewing = (user as { viewing?: string | null }).viewing;
    return viewing && file && (viewing === file.path || viewing === "code");
  });

  if (!file) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-8 py-10">
          <p className="text-[16px] text-white">No code in this room yet</p>
          <p className="mt-2 text-[14px] text-[#a8b3c7]">Start the agent or ask in Chat to write a file.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <FileTree />
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-mono text-[13px] text-cyan-200">{file.path}</p>
          <div className="flex items-center gap-2">
            {watchers.map((user) => (
              <span key={user.id} className="text-[12px] text-[#a8b3c7]">
                {user.name}
              </span>
            ))}
            {(file.status === "modified" || file.status === "added") && (
              <span className="chip">
                {file.status === "added" ? "Created" : "Modified"} · {file.modifiedBy}
              </span>
            )}
            {live && <span className="chip border-cyan-300/30 text-cyan-200">Yjs</span>}
          </div>
        </div>
        {live ? (
          <CrdtEditor path={file.path} fallback={file.content} />
        ) : (
          <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-[#070b12] p-4 font-mono text-[13px] leading-6">
            {file.content.split("\n").map((line, i) => {
              const added = line.startsWith("+");
              const removed = line.startsWith("-");
              return (
                <div key={i} className={added ? "diff-add px-1" : removed ? "diff-del px-1" : "text-[#c9d4e4]"}>
                  <span className="mr-4 inline-block w-8 select-none text-right text-[#3d4758]">{i + 1}</span>
                  {line || " "}
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
