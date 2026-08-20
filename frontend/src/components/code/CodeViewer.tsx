"use client";

import { useStore } from "@/lib/store";
import FileTree from "./FileTree";

export default function CodeViewer() {
  const { state } = useStore();
  const file = state.files.find((item) => item.path === state.selectedFilePath) ?? state.files[0];

  if (!file) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center text-[#c5cedb]">
        <div>
          <p className="text-[16px] text-[#f3f6fb]">No code in this room yet</p>
          <p className="mt-2 text-[14px]">In Chat, ask: “write two sum in python”</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 text-[#f3f6fb]">
      <FileTree />
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-[14px] text-[#f3f6fb]">{file.path}</p>
          {(file.status === "modified" || file.status === "added") && (
            <span className="text-[13px] text-[#7dd3fc]">
              {file.status === "added" ? "Created" : "Modified"} by {file.modifiedBy}
            </span>
          )}
        </div>
        <pre className="overflow-x-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-4 font-mono text-[13.5px] leading-6">
          {file.content.split("\n").map((line, i) => {
            const added = line.startsWith("+");
            const removed = line.startsWith("-");
            return (
              <div key={i} className={added ? "diff-add px-1" : removed ? "diff-del px-1" : "text-[#d5dce6]"}>
                {line || " "}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
