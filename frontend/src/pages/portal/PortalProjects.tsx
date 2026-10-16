import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { ApiError } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OPTIONS, statusLabel } from "@/lib/status";
import { formatDate, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

const OPEN_ENDED_STATUSES = ["COMPLETED", "CANCELLED"];

const columns: ColumnDef<Project, unknown>[] = [
  {
    accessorKey: "name",
    enableSorting: false,
    header: "Project",
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.original.projectNo}
          {row.original.service?.name ? ` · ${row.original.service.name}` : ""}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "status",
    enableSorting: false,
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "progress",
    enableSorting: false,
    header: "Progress",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Progress value={row.original.progress} className="h-1.5 w-24" />
        <span className="text-xs text-muted-foreground">{row.original.progress}%</span>
      </div>
    ),
  },
  {
    accessorKey: "deadline",
    enableSorting: false,
    header: "Deadline",
    cell: ({ row }) => {
      const late =
        Boolean(row.original.deadline) &&
        isOverdue(row.original.deadline) &&
        !OPEN_ENDED_STATUSES.includes(row.original.status);
      return (
        <span className={cn("text-sm", late ? "text-danger" : "text-muted-foreground")}>
          {formatDate(row.original.deadline)}
        </span>
      );
    },
  },
  {
    id: "open",
    enableSorting: false,
    header: "",
    cell: ({ row }) => (
      <Button
        asChild
        variant="ghost"
        size="sm"
        onClick={(event) => event.stopPropagation()}
      >
        <Link to={`/portal/projects/${row.original.id}`}>
          Open
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    ),
  },
];

export default function PortalProjects() {
  const navigate = useNavigate();
  const listParams = useListParams({ status: "ALL" });
  const projects = useApiList<Project>(
    [...qk.portal.projects, "list", listParams.query],
    "/portal/projects",
    listParams.query,
  );

  const search = listParams.debouncedSearch.trim().toLowerCase();
  const rows = projects.data?.items;
  const items = useMemo(() => {
    const all = rows ?? [];
    if (!search) return all;
    return all.filter(
      (project) =>
        project.name.toLowerCase().includes(search) ||
        project.projectNo.toLowerCase().includes(search) ||
        (project.service?.name ?? "").toLowerCase().includes(search),
    );
  }, [rows, search]);

  const errorStatus = projects.error instanceof ApiError ? projects.error.status : 0;
  const noAccess = errorStatus === 403 || errorStatus === 404;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your projects"
        description="Everything 3xCodz is delivering for you — status, progress and deadlines at a glance. This list is read-only; contact us to request a change."
      />

      <FilterBar>
        <SearchInput
          value={listParams.search}
          onChange={listParams.setSearch}
          placeholder="Search projects..."
        />
        <Select
          value={listParams.filters.status ?? "ALL"}
          onValueChange={(value) => listParams.setFilter("status", value)}
        >
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {OPTIONS.projectStatus.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <div className="space-y-4">
        {projects.isError ? (
          <ErrorState
            title={noAccess ? "Your projects are not available" : "We couldn't load your projects"}
            description={
              noAccess
                ? "You don't have access to this list, or it is no longer available."
                : projects.error instanceof Error
                  ? projects.error.message
                  : "Please try again in a moment."
            }
            onRetry={noAccess ? undefined : () => void projects.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={items}
            isLoading={projects.isLoading}
            emptyTitle={search ? "No projects match your search" : "No projects yet"}
            emptyDescription={
              search
                ? "Try a different project name or number."
                : "As soon as we start work on your project it will appear here."
            }
            onRowClick={(project) => navigate(`/portal/projects/${project.id}`)}
          />
        )}
        <Pagination pagination={projects.data?.pagination} onPageChange={listParams.setPage} />
      </div>
    </div>
  );
}
