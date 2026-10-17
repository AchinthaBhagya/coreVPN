import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Inbox, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import type { AppNotification } from "@/types";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const unread = useQuery({
    queryKey: qk.notifications.unread,
    queryFn: () => api.get<{ unreadCount: number }>("/notifications/unread-count"),
    refetchInterval: 60_000,
  });

  const list = useQuery({
    queryKey: qk.notifications.list,
    queryFn: () => api.get<{ items: AppNotification[]; unreadCount: number }>("/notifications", { limit: 20 }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.notifications.list });
    queryClient.invalidateQueries({ queryKey: qk.notifications.unread });
  };

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post("/notifications/read", ids ? { ids } : {}),
    onSuccess: invalidate,
  });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: invalidate });
  const clearRead = useMutation({ mutationFn: () => api.post("/notifications/clear-read"), onSuccess: invalidate });

  const count = unread.data?.unreadCount ?? 0;
  const items = list.data?.items ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-br from-destructive to-aurora-1 px-1 text-[10px] font-semibold text-white">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => readAll.mutate()} disabled={!items.some((n) => !n.isRead)}>
              <CheckCheck className="h-3.5 w-3.5" />
              Read all
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => clearRead.mutate()} disabled={!items.some((n) => n.isRead)} aria-label="Clear read">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <Separator />
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="h-6 w-6" />
              You're all caught up.
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {items.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    if (!notification.isRead) markRead.mutate([notification.id]);
                    if (notification.link) navigate(notification.link);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                    !notification.isRead && "bg-primary/10",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", notification.isRead ? "bg-muted/60" : "bg-primary")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{notification.title}</span>
                    {notification.message ? (
                      <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{notification.message}</span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-muted-foreground/80">{formatRelative(notification.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
