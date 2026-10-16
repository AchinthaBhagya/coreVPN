import { useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queryClient";
import { useApiMutation, useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { toastError, toastSuccess } from "@/lib/errors";
import { DetailHeader } from "@/components/common/DetailHeader";
import { InfoList, SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { LineItem, Quotation } from "@/types";

interface RespondVars {
  decision: "ACCEPTED" | "REJECTED";
  reason?: string;
}

const CLOSED_STATES = ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"];

export default function PortalQuotationDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { can } = useAuth();

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const quotation = useApiQuery<Quotation>(
    qk.portal.quotation(id),
    `/portal/quotations/${id}`,
    undefined,
    { enabled: Boolean(id) },
  );

  const respond = useApiMutation<Quotation, RespondVars>(
    (vars) => api.post<Quotation>(`/portal/quotations/${id}/respond`, vars),
    {
      onSuccess: (_data, vars) => {
        toastSuccess(
          vars.decision === "ACCEPTED" ? "Quotation accepted" : "Quotation rejected",
          "Your response has been recorded and our team has been notified.",
        );
        setAcceptOpen(false);
        setRejectOpen(false);
        setReason("");
        // Refetches the detail (prefix match) and the list so the status updates everywhere.
        void queryClient.invalidateQueries({ queryKey: qk.portal.quotations });
      },
      onError: (error) => toastError(error),
    },
  );

  if (quotation.isLoading) {
    return (
      <div className="space-y-6">
        <LoadingState label="Loading quotation..." />
      </div>
    );
  }

  if (quotation.isError || !quotation.data) {
    const status = quotation.error instanceof ApiError ? quotation.error.status : 0;
    const noAccess = status === 403 || status === 404;
    return (
      <div className="space-y-6">
        <DetailHeader backTo="/portal/quotations" backLabel="Back to quotations" title="Quotation" />
        <ErrorState
          title={noAccess ? "This quotation was not found or you don't have access" : "We couldn't load this quotation"}
          description={
            noAccess
              ? "The portal only shows quotations belonging to your account. Check the link or pick one from your list."
              : quotation.error instanceof Error
                ? quotation.error.message
                : "Please try again in a moment."
          }
          onRetry={noAccess ? undefined : () => void quotation.refetch()}
        />
      </div>
    );
  }

  const data = quotation.data;
  const items: LineItem[] = data.items ?? [];
  const canRespond = can("portal.quotations.respond");
  const isOpen = data.status === "SENT";
  const showRespondActions = canRespond && isOpen;

  const respondActions = showRespondActions ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => setAcceptOpen(true)} disabled={respond.isPending}>
        <CheckCircle2 className="h-4 w-4" />
        Accept
      </Button>
      <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={respond.isPending}>
        <XCircle className="h-4 w-4" />
        Reject
      </Button>
    </div>
  ) : undefined;

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/portal/quotations"
        backLabel="Back to quotations"
        title={data.quotationNo}
        subtitle={data.title}
        badge={<StatusBadge status={data.status} />}
        actions={respondActions}
      />

      {canRespond && !isOpen ? (
        <Alert variant="info">
          <Info />
          <AlertTitle>This quotation is closed for responses</AlertTitle>
          <AlertDescription>
            {data.decidedAt
              ? `Your decision was recorded on ${formatDateTime(data.decidedAt)}.`
              : CLOSED_STATES.includes(data.status)
                ? `This quotation is ${data.status.toLowerCase()} and can no longer be accepted or rejected.`
                : "This quotation can no longer be accepted or rejected in the portal."}
          </AlertDescription>
        </Alert>
      ) : null}

      {data.status === "REJECTED" && data.rejectionReason ? (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Reason for rejection</AlertTitle>
          <AlertDescription>{data.rejectionReason}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            title="Line items"
            empty={items.length === 0}
            emptyTitle="No line items"
            emptyDescription="This quotation does not break down into line items."
          >
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id ?? `line-${index}`}>
                      <TableCell className="align-top">{item.description}</TableCell>
                      <TableCell className="text-right">{formatNumber(item.quantity, 2)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney(item.unitPrice, data.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(item.discount, data.currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {item.lineTotal ? formatMoney(item.lineTotal, data.currency) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard
            title="Terms"
            empty={!data.terms}
            emptyTitle="No terms provided"
            emptyDescription="No payment terms were attached to this quotation."
          >
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.terms}</p>
          </SectionCard>

          {data.clientNotes ? (
            <SectionCard title="Notes">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.clientNotes}</p>
            </SectionCard>
          ) : null}
        </div>

        <div className="space-y-4">
          <SectionCard title="Summary">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(data.subtotal, data.currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Discount</span>
                <span>-{formatMoney(data.discountTotal, data.currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  Tax ({formatNumber(data.taxRate, 2)}%)
                </span>
                <span>{formatMoney(data.taxTotal, data.currency)}</span>
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between gap-3 text-base font-semibold">
                <span>Total</span>
                <span>{formatMoney(data.total, data.currency)}</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Details">
            <InfoList
              columns={1}
              items={[
                { label: "Currency", value: data.currency },
                { label: "Sent", value: formatDateTime(data.sentAt) },
                { label: "Valid until", value: formatDate(data.validUntil) },
                { label: "Decided", value: formatDateTime(data.decidedAt) },
              ]}
            />
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={acceptOpen}
        onOpenChange={(open) => {
          if (!respond.isPending) setAcceptOpen(open);
        }}
        title={`Accept ${data.quotationNo}?`}
        description={`You are accepting "${data.title}" for ${formatMoney(data.total, data.currency)}. Our team will be notified straight away and can begin scheduling the work.`}
        confirmLabel="Accept quotation"
        loading={respond.isPending}
        onConfirm={() => respond.mutate({ decision: "ACCEPTED" })}
      />

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!respond.isPending) setRejectOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reject {data.quotationNo}?</DialogTitle>
            <DialogDescription>
              Tell us why so we can revise the quote. Your reason is shared with our team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="quotation-rejection-reason">Reason for rejection</Label>
            <Textarea
              id="quotation-rejection-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: the timeline or budget doesn't work for us"
              rows={4}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">{reason.trim().length}/1000 characters</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={respond.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || respond.isPending}
              onClick={() =>
                respond.mutate({ decision: "REJECTED", reason: reason.trim() })
              }
            >
              {respond.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Submit rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
