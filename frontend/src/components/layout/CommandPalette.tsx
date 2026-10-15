import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  FolderKanban,
  LifeBuoy,
  ListChecks,
  ReceiptText,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";
import { NAV_GROUPS, PORTAL_NAV } from "@/lib/nav";
import type { SearchResponse, SearchResult } from "@/types";

const RESULT_ICONS: Record<SearchResult["type"], LucideIcon> = {
  client: Users,
  project: FolderKanban,
  invoice: ReceiptText,
  quotation: FileText,
  task: ListChecks,
  ticket: LifeBuoy,
  lead: Target,
};

const RESULT_LABELS: Record<SearchResult["type"], string> = {
  client: "Clients",
  project: "Projects",
  invoice: "Invoices",
  quotation: "Quotations",
  task: "Tasks",
  ticket: "Tickets",
  lead: "Leads",
};

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { user, can, canAny } = useAuth();
  const [term, setTerm] = useState("");
  const debounced = useDebounce(term, 250);

  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const isClient = Boolean(user?.isClient);
  const canSearch = !isClient && can("search.global");

  const searchQuery = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchResponse>("/search", { q: debounced }),
    enabled: open && canSearch && debounced.trim().length >= 2,
  });

  const navGroups = useMemo(() => {
    if (isClient) {
      return [
        {
          label: "Client portal",
          items: PORTAL_NAV.filter((item) => !item.permissions || canAny(...item.permissions)),
        },
      ];
    }
    return NAV_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) => !item.permissions || canAny(...item.permissions)),
    })).filter((group) => group.items.length > 0);
  }, [isClient, canAny]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const grouped = searchQuery.data?.grouped ?? {};
  const hasResults = Object.keys(grouped).length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={!canSearch || debounced.trim().length < 2}>
      <CommandInput placeholder={canSearch ? "Search clients, projects, invoices..." : "Jump to a page..."} value={term} onValueChange={setTerm} />
      <CommandList>
        <CommandEmpty>{debounced.trim().length >= 2 ? "No results found." : "Keep typing to search..."}</CommandEmpty>

        {canSearch && hasResults
          ? (Object.keys(grouped) as SearchResult["type"][]).map((type) => (
              <CommandGroup key={type} heading={RESULT_LABELS[type]}>
                {grouped[type].map((result) => {
                  const Icon = RESULT_ICONS[result.type];
                  return (
                    <CommandItem
                      key={`${result.type}-${result.id}`}
                      value={`${result.type} ${result.title} ${result.subtitle ?? ""}`}
                      onSelect={() => go(result.link)}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{result.title}</span>
                        {result.subtitle ? <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span> : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))
          : null}

        {navGroups.map((group, index) => (
          <Fragment key={group.label}>
            {index > 0 || hasResults ? <CommandSeparator /> : null}
            <CommandGroup heading={group.label}>
              {group.items.map((item) => (
                <CommandItem key={item.to} value={`${group.label} ${item.label}`} onSelect={() => go(item.to)}>
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
