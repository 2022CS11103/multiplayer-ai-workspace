"use client";

import { useStore } from "@/lib/store";
import { cn } from "@/components/common/cn";

export default function FileTree() {
  const { state, dispatch } = useStore();
  const dirs = group(state.files.map((file) => file.path));

  return (
    <div className="w-[210px] shrink-0 border-r border-white/10 bg-[#0b1018]/70 p-3 text-[13px]">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Files</p>
      {state.files.length === 0 && <p className="text-[#7d8aa0]">No files yet. Ask the agent to write code.</p>}
      {Object.entries(dirs).map(([dir, files]) => (
        <div key={dir} className="mb-2">
          <p className="mb-0.5 text-[#7d8aa0]">{dir === "." ? "src" : `${dir}/`}</p>
          {files.map((file) => {
            const path = dir === "." ? file : `${dir}/${file}`;
            return (
              <button
                key={path}
                onClick={() => dispatch({ type: "SELECT_FILE", path })}
                className={cn(
                  "block w-full truncate rounded-lg px-2 py-1 text-left font-mono text-[12px]",
                  state.selectedFilePath === path ? "bg-white/10 text-white" : "text-[#c5cedb] hover:text-white"
                )}
              >
                {file}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function group(paths: string[]) {
  const map: Record<string, string[]> = {};
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length === 1) {
      map["."] = map["."] || [];
      map["."].push(parts[0]);
    } else {
      const dir = parts[0];
      map[dir] = map[dir] || [];
      map[dir].push(parts.slice(1).join("/"));
    }
  }
  return map;
}
