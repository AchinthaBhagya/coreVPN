import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import { api, ApiError, downloadBlob } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { toastError } from "@/lib/errors";
import { DetailHeader } from "@/components/common/DetailHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize, toNumber } from "@/lib/format";
import type { Invoice } from "@/types";

export default function PortalInvoiceDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const query = useApiQuery<Invoice>(qk.portal.invoice(id), `/portal/invoices/${id}`, undefined, {
    enabled: Boolean(id),
  });

  const pdfMutation = useMutation({
    mutationFn: () => api.blob(`/portal/invoices/${id}/pdf`),
    onSuccess: (blob) => downloadBlob(blob, `${query.data?.invoiceNo ?? "invoice"}.pdf`),
    onError: (error) => toastError(error, "The invoice PDF could not be downloaded."),
  });

  if (query.isLoading) return <LoadingState label="Loading invoice..." />;

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    if (notFound) {
      return (
        <div className="space-y-6">
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="Invoice not found"
            description="This invoice doesn't exist, is still a draft, or doesn't belong to your account."
            action={
              <Button variant="outline" onClick={() => navigate("/portal/invoices")}>
                Back to invoices
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <ErrorState
        title="We couldn't load this invoice"
        description={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const invoice = query.data;
  if (!invoice) return <ErrorState description="This invoice could not be loaded." onRetry={() => void query.refetch()} />;

  const currency = invoice.currency;
  const balanceOpen = toNumber(invoice.balance) > 0;
  const isPaid = invoice.status === "PAID";
  const isRefunded = invoice.status === "REFUNDED";
  const subtotal = toNumber(invoice.subtotal);
  const discount = toNumber(invoice.discountTotal);
  const taxTotal = toNumber(invoice.taxTotal);

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/portal/invoices"
        backLabel="Invoices"
        title={invoice.invoiceNo}
        subtitle={
          invoice.project ? (
            <span>
              {invoice.project.projectNo} · {invoice.project.name}
            </span>
          ) : (
            <span>Issued {formatDate(invoice.issueDate)}</span>
          )
        }
        badge={<StatusBadge status={invoice.status} />}
        actions={
          <Button onClick={() => pdfMutation.mutate()} disabled={pdfMutation.isPending}>
            {pdfMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download PDF
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            title="Line items"
            description={`Issued ${formatDate(invoice.issueDate)} · Due ${formatDate(invoice.dueDate)}`}
            empty={(invoice.items?.length ?? 0) === 0}
            emptyTitle="No line items"
            emptyDescription="This invoice has no line items."
          >
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoice.items ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="align-top">{item.description}</TableCell>
                      <TableCell className="text-right align-top">{formatNumber(item.quantity, 2)}</TableCell>
                      <TableCell className="text-right align-top">{formatMoney(item.unitPrice, currency)}</TableCell>
                      <TableCell className="text-right align-top">{formatMoney(item.discount, currency)}</TableCell>
                      <TableCell className="text-right align-top font-medium">
                        {formatMoney(item.lineTotal ?? 0, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard
            title="Payment history"
            description="Payments recorded against this invoice by 3xCode."
            empty={(invoice.payments?.length ?? 0) === 0}
            emptyTitle="No payments yet"
            emptyDescription="Once a payment is recorded it will appear here."
          >
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoice.payments ?? []).map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">{payment.paymentNo}</TableCell>
                      <TableCell>{formatDate(payment.paidAt)}</TableCell>
                      <TableCell>{humanize(payment.method)}</TableCell>
                      <TableCell className="text-muted-foreground">{payment.reference || "-"}</TableCell>
                      <TableCell className="text-right text-emerald-300">
                        {formatMoney(payment.amount, payment.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard
            title="Notes & terms"
            empty={!invoice.notes && !invoice.terms}
            emptyTitle="No notes or terms"
            emptyDescription="Nothing was added to this invoice."
          >
            <div className="space-y-4 text-sm">
              {invoice.notes ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap text-foreground">{invoice.notes}</p>
                </div>
              ) : null}
              {invoice.terms ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Terms</p>
                  <p className="whitespace-pre-wrap text-foreground">{invoice.terms}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Totals" contentClassName="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatMoney(subtotal, currency)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Discount</span>
              <span>{discount > 0 ? `-${formatMoney(discount, currency)}` : formatMoney(0, currency)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tax ({formatNumber(invoice.taxRate, 2)}%)</span>
              <span>{formatMoney(taxTotal, currency)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="text-muted-foreground">Total</span>
              <span>{formatMoney(invoice.total, currency)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Paid</span>
              <span className="text-emerald-300">{formatMoney(invoice.amountPaid, currency)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Balance due</span>
              <span className={`text-lg font-semibold ${balanceOpen ? "text-amber-300" : "text-emerald-300"}`}>
                {formatMoney(invoice.balance, currency)}
              </span>
            </div>
            {invoice.paidAt ? (
              <p className="text-xs text-muted-foreground">Settled on {formatDateTime(invoice.paidAt)}.</p>
            ) : null}
          </SectionCard>

          {isPaid ? (
            <Alert className="border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <AlertTitle className="text-emerald-200">Paid in full</AlertTitle>
              <AlertDescription className="text-emerald-200/80">
                This invoice has no outstanding balance. A record of every payment is listed above.
              </AlertDescription>
            </Alert>
          ) : isRefunded ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Refunded</AlertTitle>
              <AlertDescription>This invoice was refunded. Any credit is reflected in the totals above.</AlertDescription>
            </Alert>
          ) : balanceOpen ? (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              <AlertTitle className="text-amber-200">Outstanding balance</AlertTitle>
              <AlertDescription className="space-y-2 text-amber-200/80">
                <p>
                  {invoice.notes
                    ? "Settle this invoice using the notes above, then share the payment reference through a support ticket so it can be matched to your account."
                    : "This invoice can't be paid online from the portal. Please contact 3xCode to arrange payment and share the payment reference through a support ticket."}
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}
