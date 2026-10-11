import Link from "next/link";
import { cn } from "./cn";

export default function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5">
      <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-cyan-300 via-sky-400 to-violet-400 text-[13px] font-black text-[#061018] shadow-[0_0_24px_rgba(125,211,252,0.35)]">
        <span className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.45),transparent)] opacity-0 transition group-hover:opacity-100" />
        F
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Forge<span className="text-cyan-300">AI</span>
        </span>
      )}
    </Link>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 via-sky-400 to-violet-400 text-[13px] font-black text-[#061018] shadow-[0_0_24px_rgba(125,211,252,0.35)]",
        className
      )}
    >
      F
    </span>
  );
}
