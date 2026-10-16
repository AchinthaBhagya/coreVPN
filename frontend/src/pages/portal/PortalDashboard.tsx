import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Briefcase,
  FileText,
  FolderKanban,
  LifeBuoy,
  Plus,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiQuery } from "@/hooks/useApi";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { clientDisplayName, formatDate, formatMoney, formatRelative, humanize } from "@/lib/format";
import type { PortalProfile } from "@/types";

/** Shapes returned by `GET /portal/dashboard` (scoped to the signed-in client). */
interface DashboardProject {
  id: string;
  name: string;
  status: string;
  progress: number;
  deadline: string | null;
  currency: string;
}

interface DashboardInvoice {
  id: string;
  invoiceNo: string;
  status: string;
  balance: string;
  dueDate: string | null;
  currency: string;
}

interface DashboardQuotation {
  id: string;
  quotationNo: string;
  title: string;
  status: string;
}

interface DashboardTicket {
  id: string;
  ticketNo: string;
  subject: string;
  status: string;
}

interface DashboardUpdate {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  project: { id: string; name: string };
}

interface PortalDashboardData {
  projects: DashboardProject[];
  invoices: DashboardInvoice[];
  quotations: DashboardQuotation[];
  tickets: DashboardTicket[];
  updates: DashboardUpdate[];
  outstandingBalance: string;
  overdueInvoiceCount: number;
}

interface PortalActivity {
  id: string;
  action: string;
  entityType: string;
  summary: string;
  createdAt: string;
}

interface FeedItem {
  id: string;
  summary: string;
  meta: string;
}

const CLOSED_PROJECT_STATUSES = ["COMPLETED", "CANCELLED"];

export default function PortalDashboard() {
  const { user, can, canAny } = useAuth();

  const dashboard = useApiQuery<PortalDashboardData>(qk.portal.dashboard, "/portal/dashboard");
  const profile = useApiQuery<PortalProfile>(qk.portal.profile, "/portal/profile");
  const activity = useApiQuery<PortalActivity[]>(["portal", "activity"], "/portal/activity");

  if (dashboard.isLoading) return <LoadingState label="Loading your portal..." />;

  if (dashboard.isError || !dashboard.data) {
    const status = dashboard.error instanceof ApiError ? dashboard.error.status : 0;
    const noAccess = status === 403 || status === 404;
    return (
      <div className="space-y-6">
        <PageHeader title="Client portal" />
        <ErrorState
          title={noAccess ? "Your portal overview is not available" : "We couldn't load your dashboard"}
          description={
            noAccess
              ? "This account does not have access to the portal overview yet. Please contact us if you believe this is a mistake."
              : dashboard.error instanceof Error
                ? dashboard.error.message
                : "Please try again in a moment."
          }
          onRetry={noAccess ? undefined : () => void dashboard.refetch()}
        />
      </div>
    );
  }

  const data = dashboard.data;
  const clientName = profile.data?.client
    ? clientDisplayName(profile.data.client)
    : (user?.firstName ?? "there");

  const activeProjects = data.projects.filter(
    (project) => !CLOSED_PROJECT_STATUSES.includes(project.status),
  ).length;
  const openTickets = data.tickets.length;
  const awaitingDecision = data.quotations.filter((quotation) => quotation.status === "SENT").length;
  const currency = data.invoices[0]?.currency ?? profile.data?.client?.currency ?? "LKR";
  const latestTicket = data.tickets[0];

  const activityFeed: FeedItem[] = activity.isError
    ? data.updates.map((update) => ({
        id: update.id,
        summary: update.title || update.body,
        meta: `${update.project.name} · ${formatRelative(update.createdAt)}`,
      }))
    : (activity.data ?? []).map((entry) => ({
        id: entry.id,
        summary: entry.summary,
        meta: `${humanize(entry.entityType)} · ${formatRelative(entry.createdAt)}`,
      }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${clientName}`}
        description="Your projects, billing and support — updated live from the 3xCodz team."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active projects"
          value={activeProjects}
          hint="Not completed or cancelled"
          icon={<Briefcase className="h-5 w-5" />}
        />
        <StatCard
          label="Open tickets"
          value={openTickets}
          hint={openTickets > 0 ? "Not closed yet" : "All caught up"}
          icon={<LifeBuoy className="h-5 w-5" />}
          tone="warning"
        />
        <StatCard
          label="Outstanding balance"
          value={formatMoney(data.outstandingBalance, currency)}
          hint={
            data.overdueInvoiceCount > 0
              ? `${data.overdueInvoiceCount} overdue invoice${data.overdueInvoiceCount === 1 ? "" : "s"}`
              : "Nothing overdue"
          }
          icon={<Wallet className="h-5 w-5" />}
          tone={data.overdueInvoiceCount > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Awaiting your response"
          value={awaitingDecision}
          hint={awaitingDecision > 0 ? "Quotations ready for your decision" : "No quotations to review"}
          icon={<FileText className="h-5 w-5" />}
          tone="accent"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Recent projects</CardTitle>
              <CardDescription>Where your active work stands right now.</CardDescription>
            </div>
            <Link
              to="/portal/projects"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.projects.length === 0 ? (
              <EmptyState
                className="py-8"
                icon={<FolderKanban className="h-6 w-6" />}
                title="No projects yet"
                description="Once we start work on your project it will show up here with live progress."
              />
            ) : (
              data.projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/portal/projects/${project.id}`}
                  className="block rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{project.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Due {formatDate(project.deadline)}
                      </p>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={project.progress} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground">{project.progress}%</span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {can("portal.invoices.view") ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">Recent invoices</CardTitle>
                <CardDescription>Balance due across your latest bills.</CardDescription>
              </div>
              <Link
                to="/portal/invoices"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.invoices.length === 0 ? (
                <EmptyState
                  className="py-8"
                  icon={<ReceiptText className="h-6 w-6" />}
                  title="No invoices yet"
                  description="Invoices will appear here as soon as they are issued."
                />
              ) : (
                data.invoices.map((invoice) => (
                  <Link
                    key={invoice.id}
                    to={`/portal/invoices/${invoice.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invoice.invoiceNo}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Due {formatDate(invoice.dueDate)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium">{formatMoney(invoice.balance, invoice.currency)}</p>
                      <StatusBadge status={invoice.status} />
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Recent activity</CardTitle>
              <CardDescription>Everything shared with you in the last few days.</CardDescription>
            </div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.isLoading ? (
              <LoadingState label="Loading activity..." className="py-8" />
            ) : activityFeed.length === 0 ? (
              <EmptyState
                className="py-8"
                title="No activity yet"
                description="Updates from your projects, invoices and tickets will appear here."
              />
            ) : (
              activityFeed.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-primary to-primary/40" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{entry.summary}</p>
                    <p className="truncate text-xs text-muted-foreground">{entry.meta}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Need a hand?</CardTitle>
            <CardDescription>Reach the team without leaving the portal.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {canAny("portal.tickets.view", "portal.tickets.create") && latestTicket ? (
              <Link
                to={`/portal/tickets/${latestTicket.id}`}
                className="mb-1 rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
              >
                <p className="truncate text-xs text-muted-foreground">Latest ticket</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    {latestTicket.ticketNo}: {latestTicket.subject}
                  </p>
                  <StatusBadge status={latestTicket.status} />
                </div>
              </Link>
            ) : null}

            {can("portal.tickets.create") && can("portal.tickets.view") ? (
              <Button asChild>
                <Link to="/portal/tickets">
                  <Plus className="h-4 w-4" />
                  Open a new support ticket
                </Link>
              </Button>
            ) : null}

            {can("portal.tickets.view") ? (
              <Button asChild variant="outline">
                <Link to="/portal/tickets">
                  <LifeBuoy className="h-4 w-4" />
                  View support tickets
                </Link>
              </Button>
            ) : null}

            {can("portal.quotations.view") ? (
              <Button asChild variant="ghost">
                <Link to="/portal/quotations">
                  <FileText className="h-4 w-4" />
                  Review quotations
                </Link>
              </Button>
            ) : null}

            {!canAny("portal.tickets.view", "portal.tickets.create", "portal.quotations.view") ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Support and quotations are not enabled for this account.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
