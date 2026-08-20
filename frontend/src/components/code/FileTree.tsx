"use client";

import { useStore } from "@/lib/store";
import { cn } from "@/components/common/cn";

export default function FileTree() {
  const { state, dispatch } = useStore();
  const dirs = group(state.files.map((file) => file.path));

  return (
    <div className="w-[200px] shrink-0 border-r border-[#343d4d] bg-[#171b22] p-3 text-[13px] text-[#f3f6fb]">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">File tree</p>
      {state.files.length === 0 && <p className="text-[#9aa6b8]">No files yet. Ask the agent to write code.</p>}
      {Object.entries(dirs).map(([dir, files]) => (
        <div key={dir} className="mb-2">
          <p className="text-[#c5cedb]">{dir === "." ? "src" : `${dir}/`}</p>
          {files.map((file) => {
            const path = dir === "." ? file : `${dir}/${file}`;
            return (
              <button
                key={path}
                onClick={() => dispatch({ type: "SELECT_FILE", path })}
                className={cn(
                  "block w-full truncate rounded px-2 py-1 text-left",
                  state.selectedFilePath === path ? "bg-[#2c3442] text-white" : "text-[#d5dce6] hover:text-white"
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
