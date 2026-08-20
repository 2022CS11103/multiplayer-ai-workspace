"use client";

import { useStore } from "@/lib/store";

export default function FilesView() {
  const { state, dispatch } = useStore();

  return (
    <div className="flex-1 overflow-auto p-5 text-[#f3f6fb]">
      <table className="w-full text-left text-[14px]">
        <thead className="text-[12px] uppercase tracking-[0.12em] text-[#c5cedb]">
          <tr>
            <th className="pb-2 font-medium">File</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium">Modified by</th>
            <th className="pb-2 font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody className="text-[#f3f6fb]">
          {state.files.length === 0 && (
            <tr>
              <td className="py-6 text-[#c5cedb]" colSpan={4}>
                No files yet. In Chat, ask the coding agent to write something.
              </td>
            </tr>
          )}
          {state.files.map((file) => (
            <tr
              key={file.path}
              className="cursor-pointer border-t border-white/[0.06] hover:bg-white/[0.03]"
              onClick={() => dispatch({ type: "SELECT_FILE", path: file.path })}
            >
              <td className="py-2.5 font-mono">{file.path}</td>
              <td className="capitalize">{file.status}</td>
              <td>{file.modifiedBy || "—"}</td>
              <td className="text-[#c5cedb]">{file.lastActivity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
