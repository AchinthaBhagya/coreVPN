import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronsLeft, Sparkles } from "lucide-react";
import { NAV_GROUPS, PORTAL_NAV } from "@/lib/nav";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
}

export function Sidebar({ collapsed, onToggle, variant = "desktop", onNavigate }: SidebarProps) {
  const { canAny, user } = useAuth();

  const isClient = Boolean(user?.isClient);
  const groups = isClient
    ? [{ label: "Client portal", items: PORTAL_NAV }]
    : NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permissions || canAny(...item.permissions)),
      })).filter((group) => group.items.length > 0);

  const compact = variant === "desktop" && collapsed;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-white/10 bg-[#070a12]/80 backdrop-blur-xl transition-[width] duration-300",
          compact ? "w-[72px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center gap-2 border-b border-white/10 px-4", compact && "justify-center px-0")}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 shadow-lg shadow-sky-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          {!compact ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">
                3xCode<span className="text-muted-foreground"> Management</span>
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{isClient ? "Client portal" : "Business suite"}</p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.label} className="space-y-1">
              {!compact ? (
                <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  {group.label}
                </p>
              ) : null}
              {group.items.map((item) => {
                const link = (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/dashboard" || item.to === "/portal"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        compact && "justify-center px-0",
                        isActive
                          ? "bg-gradient-to-r from-sky-500/20 to-violet-500/10 text-foreground"
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <motion.span
                            layoutId={`nav-active-${variant}`}
                            className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-gradient-to-b from-sky-400 to-violet-500"
                          />
                        ) : null}
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!compact ? <span className="truncate">{item.label}</span> : null}
                      </>
                    )}
                  </NavLink>
                );
                return compact ? (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </div>
          ))}
        </nav>

        {variant === "desktop" ? (
          <div className="border-t border-white/10 p-3">
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
                compact && "justify-center px-0",
              )}
            >
              <ChevronsLeft className={cn("h-4 w-4 transition-transform", compact && "rotate-180")} />
              {!compact ? "Collapse" : null}
            </button>
          </div>
        ) : null}
      </aside>
    </TooltipProvider>
  );
}
