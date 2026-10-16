import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { UserMenu } from "@/components/layout/UserMenu";
import { cn } from "@/lib/utils";

export function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/70 px-4 backdrop-blur-xl">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 border-border bg-card p-0">
          <Sidebar collapsed={false} onToggle={() => undefined} variant="mobile" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <button
        type="button"
        onClick={onOpenCommand}
        className={cn(
          "group flex h-10 max-w-md flex-1 items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/60",
        )}
      >
        <Search className="h-4 w-4" />
        <span className="truncate">Search or jump to...</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex">
          {isMac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <NotificationBell />
        <UserMenu onNavigate={(path) => navigate(path)} />
      </div>
    </header>
  );
}
