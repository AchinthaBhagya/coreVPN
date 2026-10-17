import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { AppLayout } from "@/components/layout/AppLayout";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Forbidden, FullPageLoader, PortalRoute, ProtectedRoute } from "@/components/layout/guards";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import VerifyEmail from "@/pages/VerifyEmail";
import AuthCallback from "@/pages/AuthCallback";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

/* ------------------------------ Code-split pages ---------------------------- */

const Dashboard = lazy(() => import("@/pages/Dashboard"));

const ClientList = lazy(() => import("@/pages/clients/ClientList"));
const ClientDetail = lazy(() => import("@/pages/clients/ClientDetail"));
const LeadList = lazy(() => import("@/pages/leads/LeadList"));
const ServiceList = lazy(() => import("@/pages/services/ServiceList"));

const QuotationList = lazy(() => import("@/pages/quotations/QuotationList"));
const QuotationDetail = lazy(() => import("@/pages/quotations/QuotationDetail"));
const OrderList = lazy(() => import("@/pages/orders/OrderList"));

const ProjectList = lazy(() => import("@/pages/projects/ProjectList"));
const ProjectDetail = lazy(() => import("@/pages/projects/ProjectDetail"));
const TaskList = lazy(() => import("@/pages/tasks/TaskList"));
const TimeTracking = lazy(() => import("@/pages/time/TimeTracking"));

const TicketList = lazy(() => import("@/pages/tickets/TicketList"));
const TicketDetail = lazy(() => import("@/pages/tickets/TicketDetail"));

const InvoiceList = lazy(() => import("@/pages/invoices/InvoiceList"));
const InvoiceDetail = lazy(() => import("@/pages/invoices/InvoiceDetail"));
const PaymentList = lazy(() => import("@/pages/payments/PaymentList"));
const RefundList = lazy(() => import("@/pages/refunds/RefundList"));
const ExpenseList = lazy(() => import("@/pages/expenses/ExpenseList"));

const AllocationList = lazy(() => import("@/pages/allocations/AllocationList"));
const EarningsList = lazy(() => import("@/pages/earnings/EarningsList"));
const PayoutList = lazy(() => import("@/pages/payouts/PayoutList"));

const Reports = lazy(() => import("@/pages/reports/Reports"));
const UserList = lazy(() => import("@/pages/users/UserList"));
const RoleList = lazy(() => import("@/pages/roles/RoleList"));

const CompanySettings = lazy(() => import("@/pages/settings/CompanySettings"));
const SystemSettings = lazy(() => import("@/pages/settings/SystemSettings"));
const IntegrationsSettings = lazy(() => import("@/pages/settings/IntegrationsSettings"));
const AuditLog = lazy(() => import("@/pages/settings/AuditLog"));
const ProfileSettings = lazy(() => import("@/pages/settings/ProfileSettings"));
const NotificationSettings = lazy(() => import("@/pages/settings/NotificationSettings"));

const PortalDashboard = lazy(() => import("@/pages/portal/PortalDashboard"));
const PortalProjects = lazy(() => import("@/pages/portal/PortalProjects"));
const PortalProjectDetail = lazy(() => import("@/pages/portal/PortalProjectDetail"));
const PortalQuotations = lazy(() => import("@/pages/portal/PortalQuotations"));
const PortalQuotationDetail = lazy(() => import("@/pages/portal/PortalQuotationDetail"));
const PortalInvoices = lazy(() => import("@/pages/portal/PortalInvoices"));
const PortalInvoiceDetail = lazy(() => import("@/pages/portal/PortalInvoiceDetail"));
const PortalTickets = lazy(() => import("@/pages/portal/PortalTickets"));
const PortalTicketDetail = lazy(() => import("@/pages/portal/PortalTicketDetail"));
const PortalProfile = lazy(() => import("@/pages/portal/PortalProfile"));

/* --------------------------------- Helpers ---------------------------------- */

/** UI-level permission gate. The server remains the source of authorization. */
function Gate({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { canAny } = useAuth();
  return canAny(...anyOf) ? <>{children}</> : <Forbidden />;
}

function HomeRedirect() {
  const { user, isBootstrapping } = useAuth();
  if (isBootstrapping) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.isClient ? "/portal" : "/dashboard"} replace />;
}

const STAFF = {
  dashboard: ["dashboard.view"],
  clients: ["clients.view"],
  leads: ["leads.view"],
  services: ["services.view"],
  quotations: ["quotations.view"],
  orders: ["orders.view"],
  projects: ["projects.view", "projects.viewAll"],
  tasks: ["tasks.view"],
  time: ["time.log", "time.viewAll"],
  tickets: ["tickets.view", "tickets.viewAll"],
  invoices: ["invoices.view"],
  payments: ["payments.view"],
  refunds: ["refunds.manage"],
  expenses: ["expenses.view"],
  allocations: ["allocations.view"],
  earnings: ["earnings.viewOwn", "earnings.viewAll"],
  payouts: ["payouts.view"],
  reports: ["reports.view", "reports.finance", "reports.team"],
  users: ["users.view"],
  roles: ["roles.view"],
  company: ["settings.view", "settings.company"],
  system: ["settings.view", "settings.system"],
  integrations: ["settings.integrations"],
  audit: ["audit.view"],
} as const;

export default function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router>
            <Suspense fallback={<FullPageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                {/* ------------------------------ Staff app ----------------------------- */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/dashboard" element={<Gate anyOf={[...STAFF.dashboard]}><Dashboard /></Gate>} />
                    <Route path="/clients" element={<Gate anyOf={[...STAFF.clients]}><ClientList /></Gate>} />
                    <Route path="/clients/:id" element={<Gate anyOf={[...STAFF.clients]}><ClientDetail /></Gate>} />
                    <Route path="/leads" element={<Gate anyOf={[...STAFF.leads]}><LeadList /></Gate>} />
                    <Route path="/services" element={<Gate anyOf={[...STAFF.services]}><ServiceList /></Gate>} />
                    <Route path="/quotations" element={<Gate anyOf={[...STAFF.quotations]}><QuotationList /></Gate>} />
                    <Route path="/quotations/:id" element={<Gate anyOf={[...STAFF.quotations]}><QuotationDetail /></Gate>} />
                    <Route path="/orders" element={<Gate anyOf={[...STAFF.orders]}><OrderList /></Gate>} />
                    <Route path="/projects" element={<Gate anyOf={[...STAFF.projects]}><ProjectList /></Gate>} />
                    <Route path="/projects/:id" element={<Gate anyOf={[...STAFF.projects]}><ProjectDetail /></Gate>} />
                    <Route path="/tasks" element={<Gate anyOf={[...STAFF.tasks]}><TaskList /></Gate>} />
                    <Route path="/time" element={<Gate anyOf={[...STAFF.time]}><TimeTracking /></Gate>} />
                    <Route path="/tickets" element={<Gate anyOf={[...STAFF.tickets]}><TicketList /></Gate>} />
                    <Route path="/tickets/:id" element={<Gate anyOf={[...STAFF.tickets]}><TicketDetail /></Gate>} />
                    <Route path="/invoices" element={<Gate anyOf={[...STAFF.invoices]}><InvoiceList /></Gate>} />
                    <Route path="/invoices/:id" element={<Gate anyOf={[...STAFF.invoices]}><InvoiceDetail /></Gate>} />
                    <Route path="/payments" element={<Gate anyOf={[...STAFF.payments]}><PaymentList /></Gate>} />
                    <Route path="/refunds" element={<Gate anyOf={[...STAFF.refunds]}><RefundList /></Gate>} />
                    <Route path="/expenses" element={<Gate anyOf={[...STAFF.expenses]}><ExpenseList /></Gate>} />
                    <Route path="/allocations" element={<Gate anyOf={[...STAFF.allocations]}><AllocationList /></Gate>} />
                    <Route path="/earnings" element={<Gate anyOf={[...STAFF.earnings]}><EarningsList /></Gate>} />
                    <Route path="/payouts" element={<Gate anyOf={[...STAFF.payouts]}><PayoutList /></Gate>} />
                    <Route path="/reports" element={<Gate anyOf={[...STAFF.reports]}><Reports /></Gate>} />
                    <Route path="/users" element={<Gate anyOf={[...STAFF.users]}><UserList /></Gate>} />
                    <Route path="/roles" element={<Gate anyOf={[...STAFF.roles]}><RoleList /></Gate>} />
                    <Route path="/settings/company" element={<Gate anyOf={[...STAFF.company]}><CompanySettings /></Gate>} />
                    <Route path="/settings/system" element={<Gate anyOf={[...STAFF.system]}><SystemSettings /></Gate>} />
                    <Route path="/settings/integrations" element={<Gate anyOf={[...STAFF.integrations]}><IntegrationsSettings /></Gate>} />
                    <Route path="/settings/audit" element={<Gate anyOf={[...STAFF.audit]}><AuditLog /></Gate>} />
                    <Route path="/settings/profile" element={<ProfileSettings />} />
                    <Route path="/settings/notifications" element={<NotificationSettings />} />
                  </Route>
                </Route>

                {/* ----------------------------- Client portal --------------------------- */}
                <Route element={<PortalRoute />}>
                  <Route element={<PortalLayout />}>
                    <Route path="/portal" element={<PortalDashboard />} />
                    <Route path="/portal/projects" element={<PortalRoute anyOf={["portal.projects.view"]}><PortalProjects /></PortalRoute>} />
                    <Route path="/portal/projects/:id" element={<PortalRoute anyOf={["portal.projects.view"]}><PortalProjectDetail /></PortalRoute>} />
                    <Route path="/portal/quotations" element={<PortalRoute anyOf={["portal.quotations.view"]}><PortalQuotations /></PortalRoute>} />
                    <Route path="/portal/quotations/:id" element={<PortalRoute anyOf={["portal.quotations.view"]}><PortalQuotationDetail /></PortalRoute>} />
                    <Route path="/portal/invoices" element={<PortalRoute anyOf={["portal.invoices.view"]}><PortalInvoices /></PortalRoute>} />
                    <Route path="/portal/invoices/:id" element={<PortalRoute anyOf={["portal.invoices.view"]}><PortalInvoiceDetail /></PortalRoute>} />
                    <Route path="/portal/tickets" element={<PortalRoute anyOf={["portal.tickets.view"]}><PortalTickets /></PortalRoute>} />
                    <Route path="/portal/tickets/:id" element={<PortalRoute anyOf={["portal.tickets.view"]}><PortalTicketDetail /></PortalRoute>} />
                    <Route path="/portal/profile" element={<PortalProfile />} />
                  </Route>
                </Route>

                <Route path="/" element={<HomeRedirect />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <Toaster />
          </Router>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
