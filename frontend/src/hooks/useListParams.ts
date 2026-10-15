import { useCallback, useEffect, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

export interface ListParamsState {
  page: number;
  setPage: (page: number) => void;
  limit: number;
  search: string;
  setSearch: (value: string) => void;
  /** Debounced search term, safe to send to the API. */
  debouncedSearch: string;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  setFilters: (values: Record<string, string>) => void;
  resetFilters: () => void;
  /** `page`/`limit`/`search` merged with any active filters (empty values dropped). */
  query: Record<string, string | number>;
}

/**
 * Small state container for a paginated list screen: page, debounced search and
 * arbitrary string filters. Changing the search/filters resets to page 1.
 */
export function useListParams(initialFilters: Record<string, string> = {}, limit = 20): ListParamsState {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filters, setFiltersState] = useState<Record<string, string>>(initialFilters);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters]);

  const setFilter = useCallback((key: string, value: string) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setFilters = useCallback((values: Record<string, string>) => {
    setFiltersState((prev) => ({ ...prev, ...values }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(initialFilters);
    setSearch("");
  }, [initialFilters]);

  const query: Record<string, string | number> = { page, limit };
  if (debouncedSearch.trim()) query.search = debouncedSearch.trim();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== "ALL" && value !== undefined) query[key] = value;
  }

  return {
    page,
    setPage,
    limit,
    search,
    setSearch,
    debouncedSearch,
    filters,
    setFilter,
    setFilters,
    resetFilters,
    query,
  };
}
