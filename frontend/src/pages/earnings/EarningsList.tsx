import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, Clock, Info, Wallet } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList, useApiMutation, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { toastSuccess } from "@/lib/errors";
import { formatDateTime, formatMoney } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatCard } from "@/components/common/StatCard";
import { ErrorState } from "@/components/common/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MemberEarning } from "@/types";

const EARNING_STATUSES = ["PENDING", "APPROVED", "PAID", "VOID"] as const;

/** GET /earnings/summary - always scoped to the caller. */
interface EarningsSummary {
  currency: string;
  byStatus: Record<string, string>;
  accrued: string;
  paidOut: string;
  outstanding: string;
}

export default function EarningsList() {
  const { can } = useAuth();
  const canViewOwn = can("earnings.viewOwn");
  const canViewAll = can("earnings.viewAll");
  const canApprove = can("allocations.approve");

  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(canViewOwn ? "mine" : "all");
  const params = useListParams({ status: "ALL" });
  const [voidTarget, setVoidTarget] = useState<MemberEarning | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["earnings-mine"] });
    queryClient.invalidateQueries({ queryKey: ["earnings-all"] });
    queryClient.invalidateQueries({ queryKey: ["earnings-summary"] });
  };

  const summaryQuery = useApiQuery<EarningsSummary>(["earnings-summary"], "/earnings/summary", undefined, {
    enabled: canViewOwn,
  });

  const mineList = useApiList<MemberEarning>(qk.list("earnings-mine", params.query), "/earnings/mine", params.query, {
    enabled: tab === "mine" && canViewOwn,
  });
  const allList = useApiList<MemberEarning>(qk.list("earnings-all", params.query), "/earnings", params.query, {
    enabled: tab === "all" && canViewAll,
  });

  const isMine = tab === "mine";
  const list = isMine ? mineList : allList;

  const approveMutation = useApiMutation((id: string) => api.post(`/earnings/${id}/approve`), {
    onSuccess: () => {
      toastSuccess("Earning approved", "The entitlement is signed off and can now be included in a payout.");
      invalidate();
    },
  });

  const voidMutation = useApiMutation(
    (vars: { id: string; reason?: string }) => api.post(`/earnings/${vars.id}/void`, { reason: vars.reason ?? null }),
    {
      onSuccess: () => {
        toastSuccess("Earning voided", "The entitlement is cancelled and will never be paid.");
        setVoidTarget(null);
        invalidate();
      },
    },
  );

  const actionsColumn: ColumnDef<MemberEarning, unknown> = {
    id: "actions",
    header: "Actions",
    enableSorting: false,
    cell: ({ row }) => {
      const earning = row.original;
      const canRowApprove = earning.status === "PENDING";
      const canRowVoid = earning.status === "PENDING" || earning.status === "APPROVED";
      if (!canRowApprove && !canRowVoid) return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex items-center justify-end gap-2">
          {canRowApprove ? (
            <Button
              size="sm"
              variant="outline"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate(earning.id)}
            >
              Approve
            </Button>
          ) : null}
          {canRowVoid ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => {
                setVoidTarget(earning);
                setVoidReason("");
              }}
            >
              Void
            </Button>
          ) : null}
        </div>
      );
    },
  };

  const columns: ColumnDef<MemberEarning, unknown>[] = [
    {
      id: "member",
      header: "Member",
      accessorFn: (row) => (row.user ? `${row.user.firstName} ${row.user.lastName}` : isMine ? "You" : ""),
      cell: ({ row }) => {
        const user = row.original.user;
        const name = user ? `${user.firstName} ${user.lastName}` : isMine ? "You" : "-";
        return (
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            {user?.jobTitle ? <p className="truncate text-xs text-muted-foreground">{user.jobTitle}</p> : null}
          </div>
        );
      },
    },
    {
      id: "project",
      header: "Project",
      accessorFn: (row) => row.project?.name ?? "",
      cell: ({ row }) =>
        row.original.project ? (
          <div className="min-w-0">
            <p className="truncate text-sm">{row.original.project.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.project.projectNo}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatMoney(row.original.amount, row.original.currency)}</span>
      ),
    },
    { accessorKey: "currency", header: "Currency" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
    },
    ...(canApprove ? [actionsColumn] : []),
  ];

  if (!canViewOwn && !canViewAll) {
    return <ErrorState title="No access" description="You don't have permission to view member earnings." />;
  }

  const summary = summaryQuery.data;

  const tableBlock = list.isError ? (
    <ErrorState
      title="Couldn't load earnings"
      description={list.error instanceof Error ? list.error.message : "The list failed to load."}
      onRetry={() => list.refetch()}
    />
  ) : (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        isLoading={list.isLoading}
        emptyTitle={isMine ? "No earnings yet" : "No earnings found"}
        emptyDescription={
          isMine
            ? "When an allocation is committed for a project you belong to, your share shows up here as a pending entitlement."
            : "Commit an allocation to generate member earnings, or adjust the status filter."
        }
      />
      <Pagination pagination={list.data?.pagination} onPageChange={params.setPage} />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member earnings"
        description="Accrued entitlements created by committing an allocation - claims against future payouts, never payments themselves."
      />

      <Alert variant="info">
        <Info />
        <AlertTitle>Entitlement is not payment</AlertTitle>
        <AlertDescription>
          Revenue minus expenses gives distributable profit; an allocation splits it into earnings for members. A{" "}
          <strong>PENDING</strong> earning becomes <strong>APPROVED</strong> when signed off, and only turns into real
          cash when it is attached to a payout that is marked <strong>PAID</strong>. Voided earnings are never paid.
        </AlertDescription>
      </Alert>

      {canViewOwn ? (
        summaryQuery.isError ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertDescription>
              Summary unavailable:{" "}
              {summaryQuery.error instanceof Error ? summaryQuery.error.message : "the request failed."}
            </AlertDescription>
          </Alert>
        ) : summaryQuery.isLoading || !summary ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Your accrued entitlement"
              value={formatMoney(summary.accrued, summary.currency)}
              hint="Pending + approved + paid, void excluded. A bookkeeping claim, not cash."
              icon={<Banknote className="h-5 w-5" />}
            />
            <StatCard
              label="Your paid-out cash"
              value={formatMoney(summary.paidOut, summary.currency)}
              hint="Payouts marked paid - money that actually left the business."
              icon={<Wallet className="h-5 w-5" />}
              tone="success"
            />
            <StatCard
              label="Your outstanding balance"
              value={formatMoney(summary.outstanding, summary.currency)}
              hint="Accrued entitlement that has not been paid out yet."
              icon={<Clock className="h-5 w-5" />}
              tone="warning"
            />
            <StatCard
              label="Pending approval"
              value={formatMoney(summary.byStatus.PENDING ?? "0", summary.currency)}
              hint="Entitlements waiting for sign-off before they can be paid."
              icon={<AlertTriangle className="h-5 w-5" />}
              tone="accent"
            />
          </div>
        )
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          params.setPage(1);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {canViewOwn ? <TabsTrigger value="mine">My earnings</TabsTrigger> : null}
            {canViewAll ? <TabsTrigger value="all">All earnings</TabsTrigger> : null}
          </TabsList>
          <Select value={params.filters.status ?? "ALL"} onValueChange={(value) => params.setFilter("status", value)}>
            <SelectTrigger className="w-[180px]" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {EARNING_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="mine">{tableBlock}</TabsContent>
        {canViewAll ? <TabsContent value="all">{tableBlock}</TabsContent> : null}
      </Tabs>

      <ConfirmDialog
        open={Boolean(voidTarget)}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
        title="Void this earning?"
        description="Voiding cancels the entitlement permanently - it will never be included in a payout. Paid earnings cannot be voided."
        confirmLabel="Void earning"
        destructive
        loading={voidMutation.isPending}
        onConfirm={() => {
          if (voidTarget) voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() || undefined });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="void-reason" className="text-xs font-medium text-muted-foreground">
            Reason (optional)
          </Label>
          <Textarea
            id="void-reason"
            rows={3}
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Why is this entitlement being cancelled?"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
