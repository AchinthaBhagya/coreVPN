import { useQuery, useMutation, type UseQueryOptions, type QueryKey } from "@tanstack/react-query";
import { api, type PaginationMeta, type RequestOptions } from "@/lib/api";
import { toastError } from "@/lib/errors";

export interface ApiListResult<T> {
  items: T[];
  pagination: PaginationMeta | null;
}

/** Query hook for a paginated list endpoint (returns items + pagination). */
export function useApiList<T>(
  queryKey: QueryKey,
  path: string,
  query?: RequestOptions["query"],
  options?: Omit<UseQueryOptions<ApiListResult<T>>, "queryKey" | "queryFn">,
) {
  return useQuery<ApiListResult<T>>({
    queryKey,
    queryFn: async () => {
      const { data, pagination } = await api.getWithMeta<T[]>(path, query);
      return { items: data ?? [], pagination };
    },
    ...options,
  });
}

/** Query hook for a single-object endpoint. */
export function useApiQuery<T>(
  queryKey: QueryKey,
  path: string,
  query?: RequestOptions["query"],
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">,
) {
  return useQuery<T>({
    queryKey,
    queryFn: ({ signal }) => api.get<T>(path, query, signal),
    ...options,
  });
}

/**
 * Mutation wrapper that surfaces failures as toasts. Pass `onSuccess` to
 * invalidate queries or show a confirmation.
 */
export function useApiMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options?: {
    onSuccess?: (data: TData, vars: TVars) => void;
    onError?: (error: unknown, vars: TVars) => void;
    successMessage?: string;
  },
) {
  return useMutation<TData, unknown, TVars>({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (error, vars) => {
      if (options?.onError) options.onError(error, vars);
      else toastError(error);
    },
  });
}
