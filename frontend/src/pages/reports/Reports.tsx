import { useMemo, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Briefcase,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Layers,
  LifeBuoy,
  Loader2,
  Percent,
  ReceiptText,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { api, downloadBlob } from "@/lib/api";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { toastError, toastSuccess } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DataTable } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* --------------------------------- Contract -------------------------------- */
/* Shapes below mirror `backend/src/services/reportService.ts` exactly: money
   fields are Prisma decimals (serialised as strings), dates are ISO strings. */

type ReportKey =
  | "invoice-aging"
  | "project-profitability"
  | "service-performance"
  | "lead-conversion"
  | "team-workload"
  | "member-earnings"
  | "support"
  | "cash-flow"
  | "client-history"
  | "revenue"
  | "expenses";

interface ReportParams {
  dateFrom: string;
  dateTo: string;
  currency: string;
}

interface ReportProps {
  params: ReportParams;
}

interface ReportMeta {
  key: ReportKey;
  title: string;
  description: string;
  /** Permission the endpoint requires - also gates the tab and its export. */
  permission: string;
  path: string;
  /** Present only for reports that expose a `/export` CSV sibling. */
  exportPath?: string;
  /** Endpoint understands `dateFrom`/`dateTo` query params. */
  dateRange: boolean;
  /** Endpoint understands a 3-letter `currency` query param. */
  acceptsCurrency: boolean;
  component: ComponentType<ReportProps>;
}

type CellValue = string | number | null | undefined;

interface ReportColumn<TRow> {
  header: string;
  /** Raw value used for client-side sorting. */
  accessor: (row: TRow) => CellValue;
  /** Rendered cell content. */
  cell: (row: TRow) => ReactNode;
  enableSorting?: boolean;
}

/* --------------------------------- Helpers --------------------------------- */

function buildQuery(meta: ReportMeta, params: ReportParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (meta.dateRange) {
    if (params.dateFrom) query.dateFrom = params.dateFrom;
    if (params.dateTo) query.dateTo = params.dateTo;
  }
  if (meta.acceptsCurrency && params.currency.trim()) {
    query.currency = params.currency.trim().toUpperCase();
  }
  return query;
}

function useReportData<TData>(meta: ReportMeta, params: ReportParams): { data: TData | null; guard: ReactElement | null } {
  const query = useApiQuery<TData>(["reports", meta.key, params], meta.path, buildQuery(meta, params));
  const guard =
    query.isLoading ? (
      <LoadingState label="Running report..." />
    ) : query.isError ? (
      <ErrorState
        description={query.error instanceof Error ? query.error.message : "The report could not be loaded."}
        onRetry={() => query.refetch()}
      />
    ) : null;
  return { data: query.data ?? null, guard };
}

function NoData() {
  return (
    <EmptyState
      title="Nothing to show"
      description="This report ran successfully but returned no data for the selected filters."
    />
  );
}

interface StatItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "danger" | "accent";
}

function StatGrid({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          hint={item.hint}
          icon={item.icon}
          tone={item.tone}
        />
      ))}
    </div>
  );
}

function toColumns<TRow>(columns: Array<ReportColumn<TRow>>): Array<ColumnDef<TRow, unknown>> {
  return columns.map((column, index): ColumnDef<TRow, unknown> => {
    const accessor = column.accessor;
    const cell = column.cell;
    return {
      id: `col-${index}`,
      header: column.header,
      enableSorting: column.enableSorting ?? true,
      accessorFn: (row) => accessor(row),
      cell: ({ row }) => cell(row.original),
    };
  });
}

/** "-" placeholder for nullable text cells. */
function plain(value: CellValue): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">-</span>;
  }
  return String(value);
}

/** Money cell coloured by sign (net columns). */
function signedMoney(value: CellValue, currency: string): ReactNode {
  const amount = toNumber(value);
  return <span className={amount >= 0 ? "text-success" : "text-danger"}>{formatMoney(amount, currency)}</span>;
}

/** Secondary table used by a few reports (payouts, breakdowns). */
function SecondaryTable<TRow>({
  title,
  description,
  columns,
  rows,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description?: string;
  columns: Array<ColumnDef<TRow, unknown>>;
  rows: TRow[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <SectionCard title={title} description={description}>
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </SectionCard>
  );
}

/* ------------------------------- Response types ---------------------------- */

interface InvoiceAgingRow {
  invoiceNo: string;
  client: string;
  dueDate: string | null;
  total: string;
  balance: string;
  status: string;
  daysOverdue: number;
}

interface InvoiceAgingData {
  currency: string;
  buckets: { current: string; d1_30: string; d31_60: string; d61_90: string; d90plus: string };
  rows: InvoiceAgingRow[];
}

interface ProfitabilityRow {
  projectNo: string;
  name: string;
  client: string;
  status: string;
  invoicedRevenue: string;
  cashReceived: string;
  expenses: string;
  profit: string;
  marginPercent?: number | null;
}

interface ProfitabilityData {
  currency: string;
  rows: ProfitabilityRow[];
}

interface ServicePerformanceRow {
  service: string;
  category: string;
  projects: number;
  revenue: number;
  expenses: number;
  profit: number;
}

interface ServicePerformanceData {
  currency: string;
  rows: ServicePerformanceRow[];
}

interface LeadConversionData {
  stages: Array<{ stage: string; count: number }>;
  total: number;
  won: number;
  lost: number;
  conversionRate: number;
}

interface TeamWorkloadRow {
  id: string;
  name: string;
  jobTitle: string | null;
  status: string;
  openTasks: number;
  loggedHours: number;
}

interface TeamWorkloadData {
  rows: TeamWorkloadRow[];
}

interface MemberEarningsData {
  currency: string;
  earnings: Array<{
    member: string;
    project: string;
    projectNo: string;
    model: string;
    percent: string;
    amount: string;
    status: string;
    createdAt: string;
  }>;
  payouts: Array<{
    payoutNo: string;
    member: string;
    amount: string;
    status: string;
    method: string | null;
    reference: string | null;
    paidAt: string | null;
  }>;
  totals: { accrued: string; paid: string; pending: string };
}

interface SupportTicketRow {
  ticketNo: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  assignedTo: { firstName: string; lastName: string } | null;
}

interface SupportData {
  total: number;
  open: number;
  resolved: number;
  avgFirstResponseMinutes: number;
  avgResolutionHours: number;
  byPriority: Array<{ priority: string; count: number }>;
  tickets: SupportTicketRow[];
}

interface CashFlowRow {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

interface CashFlowData {
  currency: string;
  rows: CashFlowRow[];
}

interface ClientHistoryRow {
  id: string;
  name: string;
  status: string;
  projects: number;
  invoices: number;
  tickets: number;
  lifetimeValue: string;
  paid: string;
  outstanding: string;
  clientSince: string;
}

interface ClientHistoryData {
  currency: string;
  rows: ClientHistoryRow[];
}

interface RevenueData {
  currency: string;
  byMonth: Array<{ month: string; invoiced: number; received: number; outstanding: number }>;
  rows: Array<{
    invoiceNo: string;
    date: string;
    client: string;
    status: string;
    total: string;
    received: string;
    outstanding: string;
  }>;
}

interface ExpensesData {
  currency: string;
  byCategory: Array<{ category: string; total: number }>;
  rows: Array<{
    expenseNo: string;
    date: string;
    category: string;
    vendor: string | null;
    project: string | null;
    amount: string;
    tax: string;
    status: string;
  }>;
}

/* --------------------------------- Registry -------------------------------- */
/* Component function declarations are hoisted, so they can be referenced here. */

const REPORTS: Record<ReportKey, ReportMeta> = {
  "invoice-aging": {
    key: "invoice-aging",
    title: "Invoice aging",
    description: "Outstanding balances bucketed by how far past their due date invoices have fallen.",
    permission: "reports.finance",
    path: "/reports/invoice-aging",
    exportPath: "/reports/invoice-aging/export",
    dateRange: false,
    acceptsCurrency: true,
    component: InvoiceAgingReport,
  },
  "project-profitability": {
    key: "project-profitability",
    title: "Project profitability",
    description: "Invoiced revenue, cash received, cost and margin for every project in the period.",
    permission: "reports.finance",
    path: "/reports/project-profitability",
    exportPath: "/reports/project-profitability/export",
    dateRange: true,
    acceptsCurrency: true,
    component: ProjectProfitabilityReport,
  },
  "service-performance": {
    key: "service-performance",
    title: "Service performance",
    description: "Revenue, expenses and profit grouped by the service that was delivered.",
    permission: "reports.view",
    path: "/reports/service-performance",
    dateRange: true,
    acceptsCurrency: true,
    component: ServicePerformanceReport,
  },
  "lead-conversion": {
    key: "lead-conversion",
    title: "Lead conversion",
    description: "Funnel of leads by pipeline stage with the overall win rate.",
    permission: "reports.view",
    path: "/reports/lead-conversion",
    dateRange: false,
    acceptsCurrency: false,
    component: LeadConversionReport,
  },
  "team-workload": {
    key: "team-workload",
    title: "Team workload",
    description: "Open task load and logged hours per team member.",
    permission: "reports.team",
    path: "/reports/team-workload",
    dateRange: true,
    acceptsCurrency: false,
    component: TeamWorkloadReport,
  },
  "member-earnings": {
    key: "member-earnings",
    title: "Member earnings",
    description: "Accrued earnings and payout history for members, with totals.",
    permission: "reports.finance",
    path: "/reports/member-earnings",
    dateRange: true,
    acceptsCurrency: true,
    component: MemberEarningsReport,
  },
  support: {
    key: "support",
    title: "Support performance",
    description: "Ticket volumes, first response speed and resolution time.",
    permission: "reports.view",
    path: "/reports/support",
    dateRange: true,
    acceptsCurrency: false,
    component: SupportReport,
  },
  "cash-flow": {
    key: "cash-flow",
    title: "Cash flow",
    description: "Monthly money in versus money out across the business.",
    permission: "reports.finance",
    path: "/reports/cash-flow",
    dateRange: true,
    acceptsCurrency: true,
    component: CashFlowReport,
  },
  "client-history": {
    key: "client-history",
    title: "Client history",
    description: "Lifetime value, collected payments and activity per client.",
    permission: "reports.view",
    path: "/reports/client-history",
    exportPath: "/reports/client-history/export",
    dateRange: false,
    acceptsCurrency: true,
    component: ClientHistoryReport,
  },
  revenue: {
    key: "revenue",
    title: "Revenue",
    description: "Invoiced versus received revenue by month, with invoice detail.",
    permission: "reports.finance",
    path: "/reports/revenue",
    exportPath: "/reports/revenue/export",
    dateRange: true,
    acceptsCurrency: true,
    component: RevenueReport,
  },
  expenses: {
    key: "expenses",
    title: "Expenses",
    description: "Approved and paid expenses, grouped by category.",
    permission: "reports.finance",
    path: "/reports/expenses",
    exportPath: "/reports/expenses/export",
    dateRange: true,
    acceptsCurrency: true,
    component: ExpensesReport,
  },
};

const REPORT_LIST: ReportMeta[] = Object.values(REPORTS);

/* --------------------------------- Reports --------------------------------- */

function InvoiceAgingReport({ params }: ReportProps) {
  const { data, guard } = useReportData<InvoiceAgingData>(REPORTS["invoice-aging"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, buckets, rows } = data;
  const outstanding =
    toNumber(buckets.current) +
    toNumber(buckets.d1_30) +
    toNumber(buckets.d31_60) +
    toNumber(buckets.d61_90) +
    toNumber(buckets.d90plus);

  const columns = toColumns<InvoiceAgingRow>([
    {
      header: "Invoice",
      accessor: (row) => row.invoiceNo,
      cell: (row) => <span className="font-medium">{row.invoiceNo}</span>,
    },
    { header: "Client", accessor: (row) => row.client, cell: (row) => plain(row.client) },
    { header: "Due date", accessor: (row) => row.dueDate, cell: (row) => formatDate(row.dueDate) },
    {
      header: "Status",
      accessor: (row) => row.status,
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      header: "Total",
      accessor: (row) => toNumber(row.total),
      cell: (row) => <span className="font-medium">{formatMoney(row.total, currency)}</span>,
    },
    {
      header: "Balance",
      accessor: (row) => toNumber(row.balance),
      cell: (row) => <span className="font-medium text-warning">{formatMoney(row.balance, currency)}</span>,
    },
    {
      header: "Days overdue",
      accessor: (row) => row.daysOverdue,
      cell: (row) =>
        row.daysOverdue > 0 ? (
          <span className="text-danger">{row.daysOverdue}</span>
        ) : (
          <span className="text-muted-foreground">{row.daysOverdue}</span>
        ),
    },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        className="xl:grid-cols-3"
        items={[
          { label: "Not yet due", value: formatMoney(buckets.current, currency), icon: <Wallet className="h-5 w-5" />, tone: "success" },
          { label: "1-30 days overdue", value: formatMoney(buckets.d1_30, currency), icon: <Clock3 className="h-5 w-5" />, tone: "warning" },
          { label: "31-60 days overdue", value: formatMoney(buckets.d31_60, currency), icon: <Clock3 className="h-5 w-5" />, tone: "warning" },
          { label: "61-90 days overdue", value: formatMoney(buckets.d61_90, currency), icon: <AlertTriangle className="h-5 w-5" />, tone: "danger" },
          { label: "90+ days overdue", value: formatMoney(buckets.d90plus, currency), icon: <AlertTriangle className="h-5 w-5" />, tone: "danger" },
          { label: "Total outstanding", value: formatMoney(outstanding, currency), icon: <Banknote className="h-5 w-5" />, tone: "primary" },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="Nothing outstanding"
        emptyDescription="No unpaid invoices are waiting in this currency."
      />
    </div>
  );
}

function ProjectProfitabilityReport({ params }: ReportProps) {
  const { data, guard } = useReportData<ProfitabilityData>(REPORTS["project-profitability"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, rows } = data;
  const invoiced = rows.reduce((sum, row) => sum + toNumber(row.invoicedRevenue), 0);
  const cash = rows.reduce((sum, row) => sum + toNumber(row.cashReceived), 0);
  const expenses = rows.reduce((sum, row) => sum + toNumber(row.expenses), 0);
  const profit = rows.reduce((sum, row) => sum + toNumber(row.profit), 0);

  const columns = toColumns<ProfitabilityRow>([
    {
      header: "Project",
      accessor: (row) => row.projectNo,
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.projectNo}</span>,
    },
    { header: "Name", accessor: (row) => row.name, cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Client", accessor: (row) => row.client, cell: (row) => plain(row.client) },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    { header: "Invoiced", accessor: (row) => toNumber(row.invoicedRevenue), cell: (row) => formatMoney(row.invoicedRevenue, currency) },
    { header: "Cash received", accessor: (row) => toNumber(row.cashReceived), cell: (row) => formatMoney(row.cashReceived, currency) },
    { header: "Expenses", accessor: (row) => toNumber(row.expenses), cell: (row) => formatMoney(row.expenses, currency) },
    {
      header: "Profit",
      accessor: (row) => toNumber(row.profit),
      cell: (row) => signedMoney(row.profit, currency),
    },
    {
      header: "Margin %",
      accessor: (row) => toNumber(row.marginPercent),
      cell: (row) => <span className="text-muted-foreground">{formatNumber(row.marginPercent, 1)}%</span>,
    },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Invoiced revenue", value: formatMoney(invoiced, currency), icon: <ReceiptText className="h-5 w-5" />, tone: "primary" },
          { label: "Cash received", value: formatMoney(cash, currency), icon: <Banknote className="h-5 w-5" />, tone: "success" },
          { label: "Expenses", value: formatMoney(expenses, currency), icon: <TrendingDown className="h-5 w-5" />, tone: "danger" },
          {
            label: "Net profit",
            value: formatMoney(profit, currency),
            icon: <TrendingUp className="h-5 w-5" />,
            tone: profit >= 0 ? "success" : "danger",
            hint: `${rows.length} project${rows.length === 1 ? "" : "s"} in range`,
          },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No projects in range"
        emptyDescription="No projects match the selected period and currency."
      />
    </div>
  );
}

function ServicePerformanceReport({ params }: ReportProps) {
  const { data, guard } = useReportData<ServicePerformanceData>(REPORTS["service-performance"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, rows } = data;
  const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const expenses = rows.reduce((sum, row) => sum + toNumber(row.expenses), 0);
  const profit = rows.reduce((sum, row) => sum + toNumber(row.profit), 0);

  const columns = toColumns<ServicePerformanceRow>([
    { header: "Service", accessor: (row) => row.service, cell: (row) => <span className="font-medium">{row.service}</span> },
    { header: "Category", accessor: (row) => row.category, cell: (row) => plain(row.category) },
    { header: "Projects", accessor: (row) => row.projects, cell: (row) => formatNumber(row.projects) },
    { header: "Revenue", accessor: (row) => toNumber(row.revenue), cell: (row) => formatMoney(row.revenue, currency) },
    { header: "Expenses", accessor: (row) => toNumber(row.expenses), cell: (row) => formatMoney(row.expenses, currency) },
    { header: "Profit", accessor: (row) => toNumber(row.profit), cell: (row) => signedMoney(row.profit, currency) },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Services billed", value: formatNumber(rows.length), icon: <Layers className="h-5 w-5" />, tone: "primary" },
          { label: "Revenue", value: formatMoney(revenue, currency), icon: <TrendingUp className="h-5 w-5" />, tone: "success" },
          { label: "Expenses", value: formatMoney(expenses, currency), icon: <TrendingDown className="h-5 w-5" />, tone: "danger" },
          { label: "Profit", value: formatMoney(profit, currency), icon: <Target className="h-5 w-5" />, tone: profit >= 0 ? "success" : "danger" },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No service activity"
        emptyDescription="No services produced revenue in the selected period."
      />
    </div>
  );
}

function LeadConversionReport({ params }: ReportProps) {
  const { data, guard } = useReportData<LeadConversionData>(REPORTS["lead-conversion"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const columns = toColumns<{ stage: string; count: number }>([
    { header: "Stage", accessor: (row) => row.stage, cell: (row) => <StatusBadge status={row.stage} /> },
    { header: "Leads", accessor: (row) => row.count, cell: (row) => <span className="font-medium">{formatNumber(row.count)}</span> },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Total leads", value: formatNumber(data.total), icon: <Users className="h-5 w-5" />, tone: "primary" },
          { label: "Won", value: formatNumber(data.won), icon: <Target className="h-5 w-5" />, tone: "success" },
          { label: "Lost", value: formatNumber(data.lost), icon: <AlertTriangle className="h-5 w-5" />, tone: "danger" },
          { label: "Win rate", value: `${formatNumber(data.conversionRate, 2)}%`, icon: <Percent className="h-5 w-5" />, tone: "accent" },
        ]}
      />
      <DataTable
        columns={columns}
        data={data.stages}
        emptyTitle="No leads yet"
        emptyDescription="Once leads enter the pipeline their funnel stages appear here."
      />
    </div>
  );
}

function TeamWorkloadReport({ params }: ReportProps) {
  const { data, guard } = useReportData<TeamWorkloadData>(REPORTS["team-workload"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const rows = data.rows;
  const openTasks = rows.reduce((sum, row) => sum + toNumber(row.openTasks), 0);
  const hours = rows.reduce((sum, row) => sum + toNumber(row.loggedHours), 0);

  const columns = toColumns<TeamWorkloadRow>([
    { header: "Member", accessor: (row) => row.name, cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Job title", accessor: (row) => row.jobTitle, cell: (row) => plain(row.jobTitle) },
    { header: "Account", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    {
      header: "Open tasks",
      accessor: (row) => row.openTasks,
      cell: (row) =>
        row.openTasks > 0 ? (
          <span className="font-medium text-warning">{row.openTasks}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    { header: "Hours logged", accessor: (row) => row.loggedHours, cell: (row) => formatNumber(row.loggedHours, 1) },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        className="xl:grid-cols-3"
        items={[
          { label: "Team members", value: formatNumber(rows.length), icon: <Users className="h-5 w-5" />, tone: "primary" },
          { label: "Open tasks", value: formatNumber(openTasks), icon: <Briefcase className="h-5 w-5" />, tone: openTasks > 0 ? "warning" : "success" },
          { label: "Hours logged", value: formatNumber(hours, 1), icon: <Clock3 className="h-5 w-5" />, tone: "accent" },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No team members"
        emptyDescription="No staff accounts with an active role were found."
      />
    </div>
  );
}

function MemberEarningsReport({ params }: ReportProps) {
  const { data, guard } = useReportData<MemberEarningsData>(REPORTS["member-earnings"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, earnings, payouts, totals } = data;

  const earningColumns = toColumns<MemberEarningsData["earnings"][number]>([
    { header: "Member", accessor: (row) => row.member, cell: (row) => <span className="font-medium">{row.member}</span> },
    {
      header: "Project",
      accessor: (row) => row.project,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.project}</p>
          <p className="text-xs text-muted-foreground">{row.projectNo}</p>
        </div>
      ),
    },
    { header: "Model", accessor: (row) => row.model, cell: (row) => humanize(row.model) },
    { header: "Share %", accessor: (row) => toNumber(row.percent), cell: (row) => `${formatNumber(row.percent, 2)}%` },
    {
      header: "Amount",
      accessor: (row) => toNumber(row.amount),
      cell: (row) => <span className="font-medium">{formatMoney(row.amount, currency)}</span>,
    },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    { header: "Accrued", accessor: (row) => row.createdAt, cell: (row) => <span className="text-muted-foreground">{formatDate(row.createdAt)}</span> },
  ]);

  const payoutColumns = toColumns<MemberEarningsData["payouts"][number]>([
    {
      header: "Payout",
      accessor: (row) => row.payoutNo,
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.payoutNo}</span>,
    },
    { header: "Member", accessor: (row) => row.member, cell: (row) => row.member },
    {
      header: "Amount",
      accessor: (row) => toNumber(row.amount),
      cell: (row) => <span className="font-medium">{formatMoney(row.amount, currency)}</span>,
    },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    { header: "Method", accessor: (row) => row.method, cell: (row) => (row.method ? humanize(row.method) : plain(null)) },
    { header: "Reference", accessor: (row) => row.reference, cell: (row) => plain(row.reference) },
    { header: "Paid at", accessor: (row) => row.paidAt, cell: (row) => formatDate(row.paidAt) },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        className="xl:grid-cols-3"
        items={[
          { label: "Accrued", value: formatMoney(totals.accrued, currency), icon: <Banknote className="h-5 w-5" />, tone: "primary" },
          { label: "Paid out", value: formatMoney(totals.paid, currency), icon: <Wallet className="h-5 w-5" />, tone: "success" },
          { label: "Pending", value: formatMoney(totals.pending, currency), icon: <Clock3 className="h-5 w-5" />, tone: "warning" },
        ]}
      />
      <DataTable
        columns={earningColumns}
        data={earnings}
        emptyTitle="No earnings recorded"
        emptyDescription="No member earnings were accrued in the selected period."
      />
      <SecondaryTable
        title="Payouts"
        description="Payments issued to members in the selected period."
        columns={payoutColumns}
        rows={payouts}
        emptyTitle="No payouts yet"
        emptyDescription="Nothing has been paid out in this period."
      />
    </div>
  );
}

function SupportReport({ params }: ReportProps) {
  const { data, guard } = useReportData<SupportData>(REPORTS.support, params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const columns = toColumns<SupportTicketRow>([
    {
      header: "Ticket",
      accessor: (row) => row.ticketNo,
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.ticketNo}</span>,
    },
    { header: "Subject", accessor: (row) => row.subject, cell: (row) => <span className="font-medium">{row.subject}</span> },
    { header: "Priority", accessor: (row) => row.priority, cell: (row) => <StatusBadge status={row.priority} /> },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    { header: "Created", accessor: (row) => row.createdAt, cell: (row) => <span className="text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
    { header: "First response", accessor: (row) => row.firstResponseAt, cell: (row) => formatDateTime(row.firstResponseAt) },
    { header: "Resolved", accessor: (row) => row.resolvedAt, cell: (row) => formatDateTime(row.resolvedAt) },
    {
      header: "Assignee",
      accessor: (row) => (row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : null),
      cell: (row) =>
        row.assignedTo ? (
          `${row.assignedTo.firstName} ${row.assignedTo.lastName}`
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        className="xl:grid-cols-5"
        items={[
          { label: "Tickets", value: formatNumber(data.total), icon: <LifeBuoy className="h-5 w-5" />, tone: "primary" },
          { label: "Open", value: formatNumber(data.open), icon: <Clock3 className="h-5 w-5" />, tone: data.open > 0 ? "warning" : "success" },
          { label: "Resolved", value: formatNumber(data.resolved), icon: <CheckCircle2 className="h-5 w-5" />, tone: "success" },
          { label: "Avg first response", value: `${formatNumber(data.avgFirstResponseMinutes)} min`, icon: <Clock3 className="h-5 w-5" />, tone: "accent" },
          { label: "Avg resolution", value: `${formatNumber(data.avgResolutionHours, 1)} h`, icon: <Target className="h-5 w-5" />, tone: "accent" },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">By priority</span>
        {data.byPriority.map((entry) => (
          <Badge key={entry.priority} variant="outline" className="font-mono text-[11px]">
            {humanize(entry.priority)}: {entry.count}
          </Badge>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={data.tickets}
        emptyTitle="No tickets in range"
        emptyDescription="No support tickets were raised in the selected period."
      />
    </div>
  );
}

function CashFlowReport({ params }: ReportProps) {
  const { data, guard } = useReportData<CashFlowData>(REPORTS["cash-flow"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, rows } = data;
  const inflow = rows.reduce((sum, row) => sum + toNumber(row.inflow), 0);
  const outflow = rows.reduce((sum, row) => sum + toNumber(row.outflow), 0);
  const net = inflow - outflow;

  const columns = toColumns<CashFlowRow>([
    {
      header: "Month",
      accessor: (row) => row.month,
      cell: (row) => <span className="font-medium">{formatDate(`${row.month}-01`, "MMM yyyy")}</span>,
    },
    {
      header: "Money in",
      accessor: (row) => toNumber(row.inflow),
      cell: (row) => <span className="text-success">{formatMoney(row.inflow, currency)}</span>,
    },
    {
      header: "Money out",
      accessor: (row) => toNumber(row.outflow),
      cell: (row) => <span className="text-danger">{formatMoney(row.outflow, currency)}</span>,
    },
    {
      header: "Net",
      accessor: (row) => toNumber(row.net),
      cell: (row) => signedMoney(row.net, currency),
    },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        className="xl:grid-cols-3"
        items={[
          { label: "Money in", value: formatMoney(inflow, currency), icon: <ArrowUpRight className="h-5 w-5" />, tone: "success" },
          { label: "Money out", value: formatMoney(outflow, currency), icon: <ArrowDownRight className="h-5 w-5" />, tone: "danger" },
          { label: "Net position", value: formatMoney(net, currency), icon: <Wallet className="h-5 w-5" />, tone: net >= 0 ? "success" : "danger" },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No cash movement"
        emptyDescription="No payments or expenses were recorded in the selected period."
      />
    </div>
  );
}

function ClientHistoryReport({ params }: ReportProps) {
  const { data, guard } = useReportData<ClientHistoryData>(REPORTS["client-history"], params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, rows } = data;
  const lifetime = rows.reduce((sum, row) => sum + toNumber(row.lifetimeValue), 0);
  const paid = rows.reduce((sum, row) => sum + toNumber(row.paid), 0);
  const outstanding = rows.reduce((sum, row) => sum + toNumber(row.outstanding), 0);

  const columns = toColumns<ClientHistoryRow>([
    { header: "Client", accessor: (row) => row.name, cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    { header: "Projects", accessor: (row) => row.projects, cell: (row) => formatNumber(row.projects) },
    { header: "Invoices", accessor: (row) => row.invoices, cell: (row) => formatNumber(row.invoices) },
    { header: "Tickets", accessor: (row) => row.tickets, cell: (row) => formatNumber(row.tickets) },
    {
      header: "Lifetime value",
      accessor: (row) => toNumber(row.lifetimeValue),
      cell: (row) => <span className="font-medium">{formatMoney(row.lifetimeValue, currency)}</span>,
    },
    { header: "Paid", accessor: (row) => toNumber(row.paid), cell: (row) => formatMoney(row.paid, currency) },
    {
      header: "Outstanding",
      accessor: (row) => toNumber(row.outstanding),
      cell: (row) => <span className="text-warning">{formatMoney(row.outstanding, currency)}</span>,
    },
    { header: "Client since", accessor: (row) => row.clientSince, cell: (row) => <span className="text-muted-foreground">{formatDate(row.clientSince)}</span> },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Clients", value: formatNumber(rows.length), icon: <Users className="h-5 w-5" />, tone: "primary" },
          { label: "Lifetime value", value: formatMoney(lifetime, currency), icon: <Banknote className="h-5 w-5" />, tone: "accent" },
          { label: "Collected", value: formatMoney(paid, currency), icon: <Wallet className="h-5 w-5" />, tone: "success" },
          { label: "Outstanding", value: formatMoney(outstanding, currency), icon: <AlertTriangle className="h-5 w-5" />, tone: "warning" },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No clients yet"
        emptyDescription="Client lifetime value appears once client records exist."
      />
    </div>
  );
}

function RevenueReport({ params }: ReportProps) {
  const { data, guard } = useReportData<RevenueData>(REPORTS.revenue, params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, byMonth, rows } = data;
  const invoiced = byMonth.reduce((sum, row) => sum + toNumber(row.invoiced), 0);
  const received = byMonth.reduce((sum, row) => sum + toNumber(row.received), 0);
  const outstanding = byMonth.reduce((sum, row) => sum + toNumber(row.outstanding), 0);

  const columns = toColumns<RevenueData["rows"][number]>([
    {
      header: "Invoice",
      accessor: (row) => row.invoiceNo,
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.invoiceNo}</span>,
    },
    { header: "Date", accessor: (row) => row.date, cell: (row) => formatDate(row.date) },
    { header: "Client", accessor: (row) => row.client, cell: (row) => plain(row.client) },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    {
      header: "Total",
      accessor: (row) => toNumber(row.total),
      cell: (row) => <span className="font-medium">{formatMoney(row.total, currency)}</span>,
    },
    { header: "Received", accessor: (row) => toNumber(row.received), cell: (row) => formatMoney(row.received, currency) },
    {
      header: "Outstanding",
      accessor: (row) => toNumber(row.outstanding),
      cell: (row) => <span className="text-warning">{formatMoney(row.outstanding, currency)}</span>,
    },
  ]);

  const monthColumns = toColumns<RevenueData["byMonth"][number]>([
    { header: "Month", accessor: (row) => row.month, cell: (row) => <span className="font-medium">{formatDate(`${row.month}-01`, "MMM yyyy")}</span> },
    { header: "Invoiced", accessor: (row) => toNumber(row.invoiced), cell: (row) => formatMoney(row.invoiced, currency) },
    { header: "Received", accessor: (row) => toNumber(row.received), cell: (row) => formatMoney(row.received, currency) },
    { header: "Outstanding", accessor: (row) => toNumber(row.outstanding), cell: (row) => signedMoney(row.outstanding, currency) },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Invoiced", value: formatMoney(invoiced, currency), icon: <ReceiptText className="h-5 w-5" />, tone: "primary" },
          { label: "Received", value: formatMoney(received, currency), icon: <Banknote className="h-5 w-5" />, tone: "success" },
          { label: "Outstanding", value: formatMoney(outstanding, currency), icon: <AlertTriangle className="h-5 w-5" />, tone: "warning" },
          { label: "Invoices", value: formatNumber(rows.length), icon: <FileText className="h-5 w-5" />, tone: "accent" },
        ]}
      />
      <SecondaryTable
        title="Monthly totals"
        description="Invoiced, received and outstanding value per month."
        columns={monthColumns}
        rows={byMonth}
        emptyTitle="No monthly totals"
        emptyDescription="No invoices were issued in the selected period."
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No invoices in range"
        emptyDescription="No invoices match the selected period and currency."
      />
    </div>
  );
}

function ExpensesReport({ params }: ReportProps) {
  const { data, guard } = useReportData<ExpensesData>(REPORTS.expenses, params);
  if (guard) return guard;
  if (!data) return <NoData />;

  const { currency, byCategory, rows } = data;
  const totalSpend = byCategory.reduce((sum, row) => sum + toNumber(row.total), 0);

  const columns = toColumns<ExpensesData["rows"][number]>([
    {
      header: "Expense",
      accessor: (row) => row.expenseNo,
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.expenseNo}</span>,
    },
    { header: "Date", accessor: (row) => row.date, cell: (row) => formatDate(row.date) },
    { header: "Category", accessor: (row) => row.category, cell: (row) => plain(row.category) },
    { header: "Vendor", accessor: (row) => row.vendor, cell: (row) => plain(row.vendor) },
    { header: "Project", accessor: (row) => row.project, cell: (row) => plain(row.project) },
    {
      header: "Amount",
      accessor: (row) => toNumber(row.amount),
      cell: (row) => <span className="font-medium">{formatMoney(row.amount, currency)}</span>,
    },
    { header: "Tax", accessor: (row) => toNumber(row.tax), cell: (row) => formatMoney(row.tax, currency) },
    { header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
  ]);

  const categoryColumns = toColumns<ExpensesData["byCategory"][number]>([
    { header: "Category", accessor: (row) => row.category, cell: (row) => <span className="font-medium">{row.category}</span> },
    {
      header: "Total",
      accessor: (row) => toNumber(row.total),
      cell: (row) => <span className="text-danger">{formatMoney(row.total, currency)}</span>,
    },
  ]);

  return (
    <div className="space-y-4">
      <StatGrid
        className="xl:grid-cols-3"
        items={[
          { label: "Total spend", value: formatMoney(totalSpend, currency), icon: <TrendingDown className="h-5 w-5" />, tone: "danger" },
          { label: "Categories", value: formatNumber(byCategory.length), icon: <Layers className="h-5 w-5" />, tone: "primary" },
          { label: "Records", value: formatNumber(rows.length), icon: <FileText className="h-5 w-5" />, tone: "accent" },
        ]}
      />
      <SecondaryTable
        title="Spend by category"
        description="Where approved and paid money went."
        columns={categoryColumns}
        rows={byCategory}
        emptyTitle="No category totals"
        emptyDescription="No approved expenses were recorded in the selected period."
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No expenses in range"
        emptyDescription="No approved or paid expenses match the selected filters."
      />
    </div>
  );
}

/* ---------------------------------- Screen --------------------------------- */

export default function Reports() {
  const { can } = useAuth();
  const permitted = useMemo(() => REPORT_LIST.filter((meta) => can(meta.permission)), [can]);
  const [activeKey, setActiveKey] = useState<string>(permitted[0]?.key ?? "");
  const [params, setParams] = useState<ReportParams>({ dateFrom: "", dateTo: "", currency: "" });

  const active = permitted.find((meta) => meta.key === activeKey) ?? permitted[0] ?? null;

  const exportMutation = useMutation({
    mutationFn: (input: { path: string; query: Record<string, string>; filename: string }) =>
      api.blob(input.path, input.query),
    onSuccess: (blob, input) => {
      downloadBlob(blob, input.filename);
      toastSuccess("Export ready", "Your CSV download has started.");
    },
    onError: (error) => {
      toastError(error, "The export could not be generated.");
    },
  });

  if (!active) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Analyse finance, delivery and support performance across the business."
        />
        <EmptyState
          title="No reports available"
          description="Your roles don't include reports.view, reports.finance or reports.team. Ask an administrator if you need report access."
        />
      </div>
    );
  }

  const exportPath = active.exportPath;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Pick a report, refine the period and export to CSV where available."
      />

      <Tabs value={active.key} onValueChange={setActiveKey} className="space-y-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          {permitted.map((meta) => (
            <TabsTrigger key={meta.key} value={meta.key}>
              {meta.title}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={active.key} className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">{active.title}</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">{active.description}</p>
            </div>
            {exportPath && can(active.permission) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  exportMutation.mutate({
                    path: exportPath,
                    query: buildQuery(active, params),
                    filename: `${active.key}-${new Date().toISOString().slice(0, 10)}.csv`,
                  })
                }
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export CSV
              </Button>
            ) : null}
          </div>

          {active.dateRange || active.acceptsCurrency ? (
            <FilterBar className="rounded-xl border border-border bg-muted/25 p-3">
              {active.dateRange ? (
                <>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="report-from" className="text-xs text-muted-foreground">
                      From
                    </Label>
                    <Input
                      id="report-from"
                      type="date"
                      value={params.dateFrom}
                      onChange={(event) => setParams((prev) => ({ ...prev, dateFrom: event.target.value }))}
                      className="h-9 w-40"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="report-to" className="text-xs text-muted-foreground">
                      To
                    </Label>
                    <Input
                      id="report-to"
                      type="date"
                      value={params.dateTo}
                      onChange={(event) => setParams((prev) => ({ ...prev, dateTo: event.target.value }))}
                      className="h-9 w-40"
                    />
                  </div>
                </>
              ) : null}
              {active.acceptsCurrency ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor="report-currency" className="text-xs text-muted-foreground">
                    Currency
                  </Label>
                  <Input
                    id="report-currency"
                    value={params.currency}
                    maxLength={3}
                    placeholder="USD"
                    onChange={(event) =>
                      setParams((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))
                    }
                    className="h-9 w-28 uppercase"
                  />
                </div>
              ) : null}
              {params.dateFrom || params.dateTo || params.currency ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setParams({ dateFrom: "", dateTo: "", currency: "" })}
                >
                  Reset
                </Button>
              ) : null}
            </FilterBar>
          ) : null}

          <active.component key={active.key} params={params} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
