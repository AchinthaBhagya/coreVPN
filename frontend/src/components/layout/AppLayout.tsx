import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AuroraBackdrop } from "@/components/common/AuroraBackdrop";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { useCommandPalette } from "@/hooks/useCommandPalette";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar:collapsed") === "true");
  const { open, setOpen } = useCommandPalette();
  const location = useLocation();

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem("sidebar:collapsed", String(!prev));
      return !prev;
    });
  };

  return (
    <div className="isolate relative flex min-h-screen bg-background text-foreground">
      <AuroraBackdrop />

      <div className="hidden lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenCommand={() => setOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1400px]"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </div>
  );
}
