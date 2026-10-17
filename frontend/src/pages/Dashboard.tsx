import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  FileText,
  LifeBuoy,
  ReceiptText,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useChartTheme } from "@/lib/chartTheme";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DashboardResponse {
  generatedAt: string;
  currency: string;
  kpis: Record<string, number | string>;
  deadlines: {
    overdueInvoices: Array<{ invoiceNo: string; dueDate: string | null; balance: string; client: string }>;
    upcomingProjects: Array<{ id: string; name: string; deadline: string | null; status: string; priority: string; client: string }>;
    myTasks: Array<{ id: string; title: string; dueDate: string | null; status: string; priority: string; project: string | null; assignee: string | null }>;
  };
  charts: {
    monthly: Array<{ month: string; revenue: number; expenses: number; cash: number }>;
    projectStatus: Array<{ status: string; count: number }>;
    expenseByCategory: Array<{ name: string; total: number }>;
    incomeByService: Array<{ name: string; total: number }>;
    invoiceStatus: Array<{ status: string; count: number }>;
  };
  recent: {
    payments: Array<{ id: string; amount: string; currency: string; paidAt: string; method: string; client: string; invoiceNo: string | null }>;
    activities: Array<{ id: string; summary: string; action: string; entityType: string; createdAt: string; actor: string }>;
    teamWorkload: Array<{ id: string; name: string; openTasks: number; totalTasks: number }>;
  };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const chart = useChartTheme();
  const query = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<DashboardResponse>("/dashboard"),
  });

  if (query.isLoading) return <LoadingState label="Crunching your numbers..." />;
  if (query.isError || !query.data) {
    return <ErrorState description="The dashboard could not be loaded." onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const currency = data.currency ?? "LKR";
  const k = data.kpis;

  const money = (value: unknown) => formatMoney(typeof value === "number" ? value : Number(value ?? 0), currency);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user?.firstName ?? "there"}`}
        description="A live snapshot of revenue, delivery and cash flow across the business."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Invoiced revenue" value={money(k.totalRevenue)} icon={<ReceiptText className="h-5 w-5" />} tone="primary" />
        <StatCard label="Cash received" value={money(k.receivedPayments)} icon={<Banknote className="h-5 w-5" />} tone="success" />
        <StatCard label="Outstanding" value={money(k.outstandingInvoices)} icon={<Wallet className="h-5 w-5" />} tone="warning" />
        <StatCard label="Net profit" value={money(k.netProfit)} icon={<TrendingUp className="h-5 w-5" />} tone="accent" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active projects" value={String(k.activeProjects ?? 0)} icon={<Briefcase className="h-5 w-5" />} />
        <StatCard label="Active clients" value={String(k.activeClients ?? 0)} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Open tickets" value={String(k.openTickets ?? 0)} icon={<LifeBuoy className="h-5 w-5" />} tone="warning" />
        <StatCard label="Overdue amount" value={money(k.overdueAmount)} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Revenue, cash & expenses</CardTitle>
            <CardDescription>Monthly trend for the last 12 months.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {data.charts.monthly.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No financial activity yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.charts.monthly} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chart.series.revenue} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={chart.series.revenue} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cash" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chart.series.cash} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={chart.series.cash} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chart.series.expenses} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={chart.series.expenses} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} strokeOpacity={0.6} />
                  <XAxis dataKey="month" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} width={64} />
                  <ReTooltip contentStyle={chart.tooltip} labelStyle={{ color: chart.tooltip.color }} />
                  <Area type="monotone" dataKey="revenue" stroke={chart.series.revenue} fill="url(#rev)" strokeWidth={2} name="Invoiced" />
                  <Area type="monotone" dataKey="cash" stroke={chart.series.cash} fill="url(#cash)" strokeWidth={2} name="Cash received" />
                  <Area type="monotone" dataKey="expenses" stroke={chart.series.expenses} fill="url(#exp)" strokeWidth={2} name="Expenses" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Projects by status</CardTitle>
            <CardDescription>Where delivery currently stands.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {data.charts.projectStatus.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.charts.projectStatus} dataKey="count" nameKey="status" innerRadius={50} outerRadius={90} paddingAngle={3}>
                    {data.charts.projectStatus.map((entry, index) => (
                      <Cell key={entry.status} fill={chart.categorical[index % chart.categorical.length]} stroke="transparent" />
                    ))}
                  </Pie>
                  <ReTooltip contentStyle={chart.tooltip} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Expenses by category</CardTitle>
            <CardDescription>Approved and paid spend.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {data.charts.expenseByCategory.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No expenses recorded.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.expenseByCategory} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} strokeOpacity={0.6} horizontal={false} />
                  <XAxis type="number" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} width={120} />
                  <ReTooltip contentStyle={chart.tooltip} />
                  <Bar dataKey="total" fill={chart.categorical[0]} radius={[0, 6, 6, 0]} name="Total" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Recent activity</CardTitle>
              <CardDescription>Latest changes across the workspace.</CardDescription>
            </div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recent.activities.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              data.recent.activities.slice(0, 7).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-aurora-cyan to-aurora-emerald" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{entry.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.actor} · {formatDate(entry.createdAt, "dd MMM, HH:mm")}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Upcoming deadlines</CardTitle>
              <CardDescription>Next 30 days.</CardDescription>
            </div>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.deadlines.upcomingProjects.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing due soon.</p>
            ) : (
              data.deadlines.upcomingProjects.map((project) => (
                <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{project.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{project.client}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">{formatDate(project.deadline)}</p>
                    <StatusBadge status={project.status} />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Overdue invoices</CardTitle>
              <CardDescription>Requires follow-up.</CardDescription>
            </div>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.deadlines.overdueInvoices.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-8 text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 text-success" />
                Everything is current.
              </div>
            ) : (
              data.deadlines.overdueInvoices.map((invoice) => (
                <div key={invoice.invoiceNo} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-danger/10 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{invoice.invoiceNo}</p>
                    <p className="truncate text-xs text-muted-foreground">{invoice.client}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-danger">{formatMoney(invoice.balance, currency)}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(invoice.dueDate)}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Team workload</CardTitle>
              <CardDescription>Open tasks per member.</CardDescription>
            </div>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-4">
            {data.recent.teamWorkload.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No team members.</p>
            ) : (
              data.recent.teamWorkload.map((member) => {
                const ratio = member.totalTasks > 0 ? (member.openTasks / member.totalTasks) * 100 : 0;
                return (
                  <div key={member.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{member.name}</span>
                      <span className={cn("text-xs", member.openTasks > 0 ? "text-warning" : "text-muted-foreground")}>
                        {member.openTasks} open / {member.totalTasks}
                      </span>
                    </div>
                    <Progress value={ratio} className="h-1.5" />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
