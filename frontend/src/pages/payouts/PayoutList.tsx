import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList, useApiMutation, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { toastError, toastSuccess } from "@/lib/errors";
import { formatDateTime, formatMoney, humanize, toNumber } from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MemberEarning, PaginationMeta, Payout } from "@/types";

const PAYOUT_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PAID", "CANCELLED"] as const;

interface MemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

/** Uniform view over the paginated `/payouts` and the unpaginated `/payouts/mine`. */
interface PayoutListView {
  items: Payout[];
  pagination: PaginationMeta | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

type ConfirmAction = "approve" | "pay" | "cancel";

function confirmCopy(
  action: ConfirmAction,
  payout: Payout,
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const label = `${payout.payoutNo} (${formatMoney(payout.amount, payout.currency)})`;
  if (action === "approve") {
    return {
      title: "Approve this payout?",
      description: `Approving ${label} signs off the transfer - no cash moves by itself. The payout still has to be marked paid after the money actually leaves the account.`,
      confirmLabel: "Approve payout",
      destructive: false,
    };
  }
  if (action === "pay") {
    return {
      title: "Mark this payout as paid?",
      description: `Only do this once the money has really been sent: ${label} becomes PAID and every earning it bundles settles as PAID too. This cannot be undone.`,
      confirmLabel: "Mark as paid",
      destructive: false,
    };
  }
  return {
    title: "Cancel this payout?",
    description: `${label} becomes CANCELLED and its earnings return to the member's approved pool, ready for a future payout. Paid payouts can never be cancelled.`,
    confirmLabel: "Cancel payout",
    destructive: true,
  };
}

/* ------------------------------ Page component ----------------------------- */

export default function PayoutList() {
  const { can } = useAuth();
  const canViewAll = can("payouts.view");
  const canViewOwn = can("earnings.viewOwn");
  const canManage = can("payouts.manage");
  const canApprove = can("payouts.approve");

  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(canViewAll ? "all" : "mine");
  const params = useListParams({ status: "ALL" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ payout: Payout; action: ConfirmAction } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const isAll = tab === "all";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payouts-all"] });
    queryClient.invalidateQueries({ queryKey: ["payouts-mine"] });
  };

  const allList = useApiList<Payout>(qk.list("payouts-all", params.query), "/payouts", params.query, {
    enabled: isAll && canViewAll,
  });
  const mineList = useApiQuery<Payout[]>(qk.list("payouts-mine"), "/payouts/mine", undefined, {
    enabled: !isAll && canViewOwn,
  });

  const view: PayoutListView = isAll
    ? {
        items: allList.data?.items ?? [],
        pagination: allList.data?.pagination ?? null,
        isLoading: allList.isLoading,
        isError: allList.isError,
        error: allList.error,
        refetch: () => {
          void allList.refetch();
        },
      }
    : {
        items: mineList.data ?? [],
        pagination: null,
        isLoading: mineList.isLoading,
        isError: mineList.isError,
        error: mineList.error,
        refetch: () => {
          void mineList.refetch();
        },
      };

  const approveMutation = useApiMutation((vars: { id: string }) => api.post(`/payouts/${vars.id}/approve`), {
    onSuccess: () => {
      toastSuccess(
        "Payout approved",
        "Signed off - but no cash moved yet. Mark it paid once the transfer has actually been sent.",
      );
      invalidate();
    },
  });

  const payMutation = useApiMutation((vars: { id: string }) => api.post(`/payouts/${vars.id}/pay`), {
    onSuccess: () => {
      toastSuccess(
        "Payout marked paid",
        "The cash transfer is recorded and every earning bundled into this payout has settled as PAID.",
      );
      invalidate();
      // Settled earnings change state - refresh every earnings view.
      queryClient.invalidateQueries({ queryKey: ["earnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["earnings-mine"] });
      queryClient.invalidateQueries({ queryKey: ["earnings-summary"] });
    },
  });

  const cancelMutation = useApiMutation(
    (vars: { id: string; reason?: string }) => api.post(`/payouts/${vars.id}/cancel`, { reason: vars.reason ?? null }),
    {
      onSuccess: () => {
        toastSuccess("Payout cancelled", "Its earnings are available again for a future payout.");
        invalidate();
      },
    },
  );

  const pendingMutation = approveMutation.isPending || payMutation.isPending || cancelMutation.isPending;

  const closeConfirm = () => {
    setConfirmTarget(null);
    setCancelReason("");
  };

  const runConfirm = () => {
    if (!confirmTarget) return;
    const { payout, action } = confirmTarget;
    const reason = cancelReason.trim();
    closeConfirm();
    if (action === "approve") approveMutation.mutate({ id: payout.id });
    else if (action === "pay") payMutation.mutate({ id: payout.id });
    else cancelMutation.mutate({ id: payout.id, reason: reason || undefined });
  };

  const actionsColumn: ColumnDef<Payout, unknown> = {
    id: "actions",
    header: "Actions",
    enableSorting: false,
    cell: ({ row }) => {
      const payout = row.original;
      const pending = payout.status === "DRAFT" || payout.status === "PENDING_APPROVAL";
      const showApprove = canApprove && pending;
      const showPay = canApprove && payout.status === "APPROVED";
      // Cancelling mirrors the backend: payouts.manage, and paid payouts are final.
      const showCancel = canManage && payout.status !== "PAID" && payout.status !== "CANCELLED";
      if (!showApprove && !showPay && !showCancel) return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex items-center justify-end gap-2">
          {showApprove ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pendingMutation}
              onClick={() => setConfirmTarget({ payout, action: "approve" })}
            >
              Approve
            </Button>
          ) : null}
          {showPay ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pendingMutation}
              onClick={() => setConfirmTarget({ payout, action: "pay" })}
            >
              Mark paid
            </Button>
          ) : null}
          {showCancel ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={pendingMutation}
              onClick={() => {
                setCancelReason("");
                setConfirmTarget({ payout, action: "cancel" });
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      );
    },
  };

  const columns: ColumnDef<Payout, unknown>[] = [
    {
      accessorKey: "payoutNo",
      header: "Payout #",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.payoutNo}</span>,
    },
    {
      id: "member",
      header: "Member",
      accessorFn: (row) => (row.user ? `${row.user.firstName} ${row.user.lastName}` : isAll ? "" : "You"),
      cell: ({ row }) => {
        const payout = row.original;
        const name = payout.user ? `${payout.user.firstName} ${payout.user.lastName}` : isAll ? "-" : "You";
        return <span className="font-medium">{name}</span>;
      },
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatMoney(row.original.amount, row.original.currency)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "method",
      header: "Method",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{humanize(row.original.method)}</p>
          {row.original.reference ? (
            <p className="truncate text-xs text-muted-foreground">ref {row.original.reference}</p>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
    ...(canApprove || canManage ? [actionsColumn] : []),
  ];

  if (!canViewAll && !canViewOwn) {
    return <ErrorState title="No access" description="You don't have permission to view payouts." />;
  }

  const tableBlock = view.isError ? (
    <ErrorState
      title="Couldn't load payouts"
      description={view.error instanceof Error ? view.error.message : "The payout list failed to load."}
      onRetry={view.refetch}
    />
  ) : (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={view.items}
        isLoading={view.isLoading}
        emptyTitle={isAll ? "No payouts found" : "No payouts yet"}
        emptyDescription={
          isAll
            ? "A payout bundles one member's approved earnings into a single recorded cash transfer. Create one from the approved earnings pool, or adjust the status filter."
            : "Payouts recorded for you will appear here once Finance creates them from your approved earnings."
        }
        emptyAction={
          canManage && isAll && (params.filters.status ?? "ALL") === "ALL" ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New payout
            </Button>
          ) : undefined
        }
      />
      <Pagination pagination={view.pagination} onPageChange={params.setPage} />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description="Bundles of approved member earnings paired with the real cash transfers that settle them."
        actions={
          canManage ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New payout
            </Button>
          ) : null
        }
      />

      <Alert variant="info">
        <Info />
        <AlertTitle>Approval is not payment - "Mark paid" is</AlertTitle>
        <AlertDescription>
          An earning is an accrued entitlement: money a member is owed, not money they have received. A payout groups a
          member's approved earnings into one transfer, and only becomes real cash when it is marked{" "}
          <strong>PAID</strong> - the moment the money actually leaves the business, which also settles every bundled
          earning as PAID.
        </AlertDescription>
      </Alert>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          params.setPage(1);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {canViewAll ? <TabsTrigger value="all">Payouts</TabsTrigger> : null}
            {canViewOwn ? <TabsTrigger value="mine">My payouts</TabsTrigger> : null}
          </TabsList>
          {isAll ? (
            <Select
              value={params.filters.status ?? "ALL"}
              onValueChange={(value) => params.setFilter("status", value)}
            >
              <SelectTrigger className="w-[190px]" aria-label="Filter by payout status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {PAYOUT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <TabsContent value="all">{tableBlock}</TabsContent>
        <TabsContent value="mine">{tableBlock}</TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
        title={confirmTarget ? confirmCopy(confirmTarget.action, confirmTarget.payout).title : ""}
        description={confirmTarget ? confirmCopy(confirmTarget.action, confirmTarget.payout).description : ""}
        confirmLabel={confirmTarget ? confirmCopy(confirmTarget.action, confirmTarget.payout).confirmLabel : "Confirm"}
        destructive={confirmTarget?.action === "cancel"}
        loading={pendingMutation}
        onConfirm={runConfirm}
      >
        {confirmTarget?.action === "cancel" ? (
          <div className="space-y-2">
            <Label htmlFor="cancel-reason" className="text-xs font-medium text-muted-foreground">
              Reason (optional)
            </Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Why is this payout being cancelled?"
            />
          </div>
        ) : null}
      </ConfirmDialog>

      {dialogOpen ? <NewPayoutDialog onClose={() => setDialogOpen(false)} /> : null}
    </div>
  );
}

/* --------------------------- New payout dialog ---------------------------- */

function NewPayoutDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [userId, setUserId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [method, setMethod] = useState<string>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitForApproval, setSubmitForApproval] = useState(true);

  // Full staff directory (needs users.view).
  const directoryQuery = useApiQuery<MemberOption[]>(["users", "assignable"], "/users/assignable");

  // Every approved earning in the business (needs earnings.viewAll). Doubles as a
  // fallback member list: finance roles with payouts.manage can read /earnings but
  // may not hold users.view.
  const poolQuery = useApiList<MemberEarning>(qk.list("payout-earnings-pool"), "/earnings", {
    status: "APPROVED",
    limit: 200,
  });

  const poolMembers = useMemo(() => {
    const map = new Map<string, MemberOption>();
    for (const earning of poolQuery.data?.items ?? []) {
      if (earning.user && !map.has(earning.user.id)) {
        map.set(earning.user.id, {
          id: earning.user.id,
          firstName: earning.user.firstName,
          lastName: earning.user.lastName,
        });
      }
    }
    return Array.from(map.values());
  }, [poolQuery.data]);

  const memberOptions = useMemo(() => {
    const source = directoryQuery.data && directoryQuery.data.length > 0 ? directoryQuery.data : poolMembers;
    const map = new Map<string, string>();
    for (const user of source) map.set(user.id, `${user.firstName} ${user.lastName}`);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [directoryQuery.data, poolMembers]);

  const membersLoading = directoryQuery.isLoading || poolQuery.isLoading;

  const earningsQuery = useApiList<MemberEarning>(
    qk.list("payout-earnings", { userId }),
    "/earnings",
    { userId, status: "APPROVED", limit: 200 },
    { enabled: Boolean(userId) },
  );

  const earnings = earningsQuery.data?.items ?? [];
  const selectedEarnings = earnings.filter((earning) => selectedIds.includes(earning.id));
  const total = selectedEarnings.reduce((sum, earning) => sum + toNumber(earning.amount), 0);
  const totalCurrency = selectedEarnings[0]?.currency ?? "LKR";

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<Payout>("/payouts", {
        userId,
        earningIds: selectedIds,
        method,
        reference: reference.trim() ? reference.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
        submitForApproval,
      }),
    onSuccess: (payout) => {
      toastSuccess(
        "Payout created",
        `${payout.payoutNo} for ${formatMoney(payout.amount, payout.currency)} is ${
          payout.status === "PENDING_APPROVAL" ? "waiting for approval" : "saved as a draft"
        }. No cash has moved until it is approved and then marked paid.`,
      );
      queryClient.invalidateQueries({ queryKey: ["payouts-all"] });
      queryClient.invalidateQueries({ queryKey: ["payouts-mine"] });
      onClose();
    },
    onError: (error) => toastError(error),
  });

  const canSubmit = Boolean(userId) && selectedIds.length > 0 && !createMutation.isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New payout</DialogTitle>
          <DialogDescription>
            Bundle one member's approved earnings into a single recorded transfer. Creating it books nothing by itself -
            cash only counts as sent once the payout is approved and marked paid.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) createMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="payout-member" className="text-xs font-medium text-muted-foreground">
              Member <span className="text-destructive">*</span>
            </Label>
            <Select
              value={userId || undefined}
              disabled={membersLoading}
              onValueChange={(value) => {
                setUserId(value);
                setSelectedIds([]);
              }}
            >
              <SelectTrigger id="payout-member" className="w-full">
                <SelectValue placeholder={membersLoading ? "Loading members..." : "Select member..."} />
              </SelectTrigger>
              <SelectContent>
                {memberOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {directoryQuery.isError && poolQuery.isError ? (
              <p className="text-xs font-medium text-destructive">
                Couldn't load the member directory (needs users.view) or the approved-earnings pool (needs
                earnings.viewAll).
              </p>
            ) : directoryQuery.isError ? (
              <p className="text-xs text-muted-foreground">
                Member directory unavailable (needs users.view) - listing members who have approved earnings instead.
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  Approved earnings <span className="text-destructive">*</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Only APPROVED entitlements can be paid. Earnings already attached to another payout are rejected by
                  the server.
                </p>
              </div>
              {earnings.length > 0 ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(earnings.map((earning) => earning.id))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={selectedIds.length === 0}
                    onClick={() => setSelectedIds([])}
                  >
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>

            {!userId ? (
              <p className="rounded-xl border border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
                Pick a member to list their approved earnings.
              </p>
            ) : earningsQuery.isLoading ? (
              <LoadingState label="Loading approved earnings..." />
            ) : earningsQuery.isError ? (
              <ErrorState
                title="Couldn't load earnings"
                description={
                  earningsQuery.error instanceof Error ? earningsQuery.error.message : "The earnings failed to load."
                }
                onRetry={() => earningsQuery.refetch()}
              />
            ) : earnings.length === 0 ? (
              <EmptyState
                title="No approved earnings"
                description="This member has no approved entitlements to pay out yet. Commit an allocation, then approve the resulting earnings."
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {selectedIds.length} of {earnings.length} earning(s) selected.
                </p>

                {earnings.map((earning) => {
                  const checked = selectedIds.includes(earning.id);
                  return (
                    <div
                      key={earning.id}
                      role="checkbox"
                      aria-checked={checked}
                      tabIndex={0}
                      onClick={() => toggle(earning.id)}
                      onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") {
                          event.preventDefault();
                          toggle(earning.id);
                        }
                      }}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Checkbox
                          checked={checked}
                          className="pointer-events-none"
                          aria-label={`Select earning from ${earning.project?.name ?? "project"}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{earning.project?.name ?? "Project"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {earning.project?.projectNo ? `${earning.project.projectNo} · ` : ""}
                            {formatDateTime(earning.createdAt)}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-sm">
                        {formatMoney(earning.amount, earning.currency)}
                      </span>
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/25 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payout total</p>
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(total, totalCurrency)}</p>
                  </div>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    The server recomputes this total from the selected earnings and rejects it if it is not greater than
                    zero.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="payout-method" className="text-xs font-medium text-muted-foreground">
                Payment method
              </Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="payout-method" className="w-full">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent>
                  {OPTIONS.paymentMethod.map((option) => (
                    <SelectItem key={option} value={option}>
                      {statusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Defaults to Bank transfer if left unset.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout-reference" className="text-xs font-medium text-muted-foreground">
                Reference (optional)
              </Label>
              <Input
                id="payout-reference"
                value={reference}
                maxLength={120}
                onChange={(event) => setReference(event.target.value)}
                placeholder="e.g. bank transaction ID"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payout-notes" className="text-xs font-medium text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              id="payout-notes"
              rows={2}
              value={notes}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything an approver should know about this transfer..."
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div>
              <Label htmlFor="payout-submit" className="text-sm font-medium">
                Submit for approval
              </Label>
              <p className="text-xs text-muted-foreground">
                Creates the payout as PENDING_APPROVAL instead of DRAFT. Either way it must be approved, then marked
                paid, before any cash counts as sent.
              </p>
            </div>
            <Switch
              id="payout-submit"
              checked={submitForApproval}
              onCheckedChange={(checked) => setSubmitForApproval(checked === true)}
            />
          </div>

          {!userId || selectedIds.length === 0 ? (
            <p className="text-xs font-medium text-warning">
              Pick a member and at least one approved earning to create the payout.
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {createMutation.isPending ? "Creating..." : "Create payout"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
