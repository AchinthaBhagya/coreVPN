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
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/60 px-4 backdrop-blur-2xl">
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
          "group flex h-10 max-w-md flex-1 items-center gap-3 rounded-full border border-border/70 bg-muted/30 px-4 text-sm text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <Search className="h-4 w-4 transition-colors group-hover:text-primary" />
        <span className="truncate">Search or jump to...</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex">
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
