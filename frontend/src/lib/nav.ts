import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Target,
  Package,
  FileText,
  ShoppingCart,
  FolderKanban,
  ListChecks,
  Clock,
  ReceiptText,
  Banknote,
  Undo2,
  Wallet,
  PieChart,
  Coins,
  HandCoins,
  LifeBuoy,
  BarChart3,
  Settings,
  UserCog,
  ShieldCheck,
  ScrollText,
  Building2,
  PlugZap,
  type LucideProps,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Any one of these permissions grants visibility (server still authorises). */
  permissions?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, permissions: ["dashboard.view"] },
    ],
  },
  {
    label: "Sales & CRM",
    items: [
      { label: "Clients", to: "/clients", icon: Users, permissions: ["clients.view"] },
      { label: "Leads", to: "/leads", icon: Target, permissions: ["leads.view"] },
      { label: "Services", to: "/services", icon: Package, permissions: ["services.view"] },
      { label: "Quotations", to: "/quotations", icon: FileText, permissions: ["quotations.view"] },
      { label: "Orders", to: "/orders", icon: ShoppingCart, permissions: ["orders.view"] },
    ],
  },
  {
    label: "Delivery",
    items: [
      { label: "Projects", to: "/projects", icon: FolderKanban, permissions: ["projects.view"] },
      { label: "Tasks", to: "/tasks", icon: ListChecks, permissions: ["tasks.view"] },
      { label: "Time tracking", to: "/time", icon: Clock, permissions: ["time.log", "time.viewAll"] },
      { label: "Support tickets", to: "/tickets", icon: LifeBuoy, permissions: ["tickets.view", "tickets.viewAll"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", to: "/invoices", icon: ReceiptText, permissions: ["invoices.view"] },
      { label: "Payments", to: "/payments", icon: Banknote, permissions: ["payments.view"] },
      { label: "Refunds", to: "/refunds", icon: Undo2, permissions: ["refunds.manage"] },
      { label: "Expenses", to: "/expenses", icon: Wallet, permissions: ["expenses.view"] },
      { label: "Profit allocation", to: "/allocations", icon: PieChart, permissions: ["allocations.view"] },
      { label: "Earnings", to: "/earnings", icon: Coins, permissions: ["earnings.viewOwn", "earnings.viewAll"] },
      { label: "Payouts", to: "/payouts", icon: HandCoins, permissions: ["payouts.view"] },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports", to: "/reports", icon: BarChart3, permissions: ["reports.view", "reports.finance", "reports.team"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", to: "/users", icon: UserCog, permissions: ["users.view"] },
      { label: "Roles & permissions", to: "/roles", icon: ShieldCheck, permissions: ["roles.view"] },
      { label: "Company", to: "/settings/company", icon: Building2, permissions: ["settings.view"] },
      { label: "Integrations", to: "/settings/integrations", icon: PlugZap, permissions: ["settings.integrations"] },
      { label: "Audit log", to: "/settings/audit", icon: ScrollText, permissions: ["audit.view"] },
      { label: "System", to: "/settings/system", icon: Settings, permissions: ["settings.view"] },
    ],
  },
];

export const PORTAL_NAV: NavItem[] = [
  { label: "Overview", to: "/portal", icon: LayoutDashboard },
  { label: "Projects", to: "/portal/projects", icon: FolderKanban, permissions: ["portal.projects.view"] },
  { label: "Quotations", to: "/portal/quotations", icon: FileText, permissions: ["portal.quotations.view"] },
  { label: "Invoices", to: "/portal/invoices", icon: ReceiptText, permissions: ["portal.invoices.view"] },
  { label: "Support", to: "/portal/tickets", icon: LifeBuoy, permissions: ["portal.tickets.view"] },
];

export type { LucideProps };
