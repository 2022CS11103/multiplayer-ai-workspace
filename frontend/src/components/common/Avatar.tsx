import { cn } from "./cn";

export default function Avatar({
  initials,
  color,
  size = "sm",
  agent = false,
}: {
  initials: string;
  color: string;
  size?: "sm" | "md";
  agent?: boolean;
}) {
  const dim = size === "md" ? "h-7 w-7 text-[11px]" : "h-6 w-6 text-[10px]";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-black",
        dim,
        agent && "rounded-[6px] text-zinc-950"
      )}
      style={{ background: color }}
    >
      {agent ? "⌘" : initials}
    </span>
  );
}
