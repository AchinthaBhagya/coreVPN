import type { PaginationMeta, ApiError } from "@/lib/api";

export type { PaginationMeta };
export { ApiError };

/* --------------------------------- Auth ----------------------------------- */

export interface AuthRole {
  id: string;
  name: string;
  type: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  avatarId: string | null;
  jobTitle: string | null;
  permissions: string[];
  roles: AuthRole[];
  isClient: boolean;
  clientId: string | null;
  phone?: string | null;
  lastLogin?: string | null;
  twoFactorEnabled?: boolean;
}

/* ------------------------------ Common shapes ----------------------------- */

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  jobTitle?: string | null;
}

export interface ClientRef {
  id: string;
  companyName: string | null;
  firstName: string;
  lastName: string;
}

export interface ProjectRef {
  id: string;
  name: string;
  projectNo: string;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

/* -------------------------------- Clients --------------------------------- */

export interface Client extends ClientRef {
  email: string;
  phone: string | null;
  type: string;
  status: string;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  taxId: string | null;
  currency: string;
  leadSource: string | null;
  tags: string[] | null;
  notes: string | null;
  accountManagerId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { projects: number; invoices: number; tickets: number; quotations?: number };
  contacts?: ClientContact[];
  notesList?: ClientNote[];
}

export interface ClientContact {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
}

export interface ClientNote {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  authorId: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
  actor?: { firstName: string; lastName: string } | null;
}

/* --------------------------------- Leads ---------------------------------- */

export interface Lead {
  id: string;
  companyName: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string | null;
  status: string;
  estimatedValue: string | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------- Services -------------------------------- */

export interface Service {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  pricingModel: string;
  basePrice: string;
  currency: string;
  isActive: boolean;
}

/* ------------------------------ Quotations -------------------------------- */

export interface LineItem {
  id?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineTotal?: string;
  sortOrder?: number;
}

export interface Quotation {
  id: string;
  quotationNo: string;
  title: string;
  status: string;
  clientId: string;
  projectId: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxRate: string;
  taxTotal: string;
  total: string;
  validUntil: string | null;
  clientNotes: string | null;
  terms: string | null;
  rejectionReason: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client?: ClientRef;
  project?: ProjectRef | null;
  items?: LineItem[];
}

/* --------------------------------- Orders --------------------------------- */

export interface ServiceOrder {
  id: string;
  orderNo: string;
  clientId: string;
  serviceId: string | null;
  title: string;
  description: string | null;
  status: string;
  total: string;
  currency: string;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  client?: ClientRef;
  service?: { id: string; name: string } | null;
}

/* -------------------------------- Projects -------------------------------- */

export interface ProjectMember {
  id: string;
  userId: string;
  role: string | null;
  user?: PersonRef;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  isClientVisible: boolean;
  sortOrder: number;
  completedAt: string | null;
}

export interface ChecklistItem {
  id: string;
  title: string;
  isDone: boolean;
  sortOrder: number;
}

export interface ProjectUpdate {
  id: string;
  title: string | null;
  body: string;
  isClientVisible: boolean;
  createdAt: string;
  author?: { firstName: string; lastName: string } | null;
}

export interface RevisionRequest {
  id: string;
  title: string;
  description: string;
  status: string;
  response: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Project {
  id: string;
  projectNo: string;
  name: string;
  description: string | null;
  clientId: string;
  serviceId: string | null;
  managerId: string | null;
  status: string;
  priority: string;
  budget: string;
  currency: string;
  progress: number;
  estimatedHours: string | null;
  startDate: string | null;
  deadline: string | null;
  completedAt: string | null;
  internalNotes: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
  client?: ClientRef & { email?: string };
  manager?: PersonRef | null;
  service?: { id: string; name: string; category?: string | null } | null;
  members?: ProjectMember[];
  milestones?: Milestone[];
  checklist?: ChecklistItem[];
  updates?: ProjectUpdate[];
  _count?: { tasks: number; milestones: number; members: number; invoices?: number; updates?: number; revisions?: number; attachments?: number };
}

export interface ProjectFinancials {
  project: { id: string; projectNo: string; name: string; currency: string };
  invoicedRevenue?: string;
  cashReceived?: string;
  expenses?: string;
  profit?: string;
  distributable?: string;
  marginPercent?: number;
  [key: string]: unknown;
}

/* --------------------------------- Tasks ---------------------------------- */

export interface Task {
  id: string;
  projectId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  reporterId: string;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: string | null;
  labels: string[] | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee?: PersonRef | null;
  reporter?: PersonRef | null;
  project?: ProjectRef | null;
  subtasks?: Task[];
  comments?: TaskComment[];
  checklist?: ChecklistItem[];
  attachments?: Attachment[];
  _count?: { subtasks: number; comments: number };
}

export interface TaskComment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author?: { firstName: string; lastName: string } | null;
}

export interface TimeEntry {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  description: string | null;
  hours: string;
  billable: boolean;
  entryDate: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  approvedById: string | null;
  createdAt: string;
  user?: PersonRef;
  project?: ProjectRef | null;
  task?: { id: string; title: string } | null;
}

/* -------------------------------- Invoices -------------------------------- */

export interface InvoiceItem extends LineItem {
  id: string;
}

export interface Payment {
  id: string;
  paymentNo: string;
  invoiceId: string | null;
  clientId: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  paidAt: string;
  notes: string | null;
  isVoid: boolean;
  voidReason: string | null;
  createdAt: string;
  client?: ClientRef;
  invoice?: { id: string; invoiceNo: string; total?: string; balance?: string; status?: string } | null;
  recordedBy?: { firstName: string; lastName: string } | null;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  clientId: string;
  projectId: string | null;
  orderId: string | null;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  subtotal: string;
  discountTotal: string;
  taxRate: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  notes: string | null;
  terms: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItem[];
  client?: Client & { email: string };
  project?: ProjectRef | null;
  payments?: Payment[];
  refunds?: Refund[];
}

export interface Refund {
  id: string;
  refundNo: string;
  invoiceId: string | null;
  paymentId: string | null;
  clientId: string;
  amount: string;
  currency: string;
  reason: string | null;
  method: string | null;
  refundedAt: string;
  createdAt: string;
  client?: ClientRef;
  invoice?: { id: string; invoiceNo: string } | null;
}

/* -------------------------------- Expenses -------------------------------- */

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count?: { expenses: number };
}

export interface Expense {
  id: string;
  expenseNo: string;
  categoryId: string;
  projectId: string | null;
  vendor: string | null;
  description: string;
  amount: string;
  taxAmount: string;
  currency: string;
  expenseDate: string;
  method: string;
  status: string;
  isRecurring: boolean;
  frequency: string;
  nextDueDate: string | null;
  isClientBillable: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  category?: { id: string; name: string };
  project?: ProjectRef | null;
  createdBy?: { firstName: string; lastName: string } | null;
}

/* ------------------------ Allocation / earnings / payouts ------------------ */

export interface AllocationRuleItem {
  id: string;
  userId: string;
  percent: string | null;
  fixedAmount: string | null;
  role: string | null;
  user?: PersonRef;
}

export interface AllocationRule {
  id: string;
  projectId: string;
  name: string;
  model: string;
  version: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  items: AllocationRuleItem[];
  createdBy?: { firstName: string; lastName: string } | null;
  _count?: { earnings: number };
}

export interface AllocationPreviewLine {
  userId: string;
  user?: PersonRef;
  role?: string | null;
  percent?: string | null;
  fixedAmount?: string | null;
  amount: string;
}

export interface AllocationPreview {
  projectId: string;
  currency: string;
  model?: string;
  distributable: string;
  allocated: string;
  remainder: string;
  reconciles: boolean;
  lines: AllocationPreviewLine[];
  rule?: AllocationRule | null;
  notes?: string[];
}

export interface MemberEarning {
  id: string;
  userId: string;
  projectId: string;
  ruleId: string | null;
  amount: string;
  currency: string;
  status: string;
  approvedById: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  user?: PersonRef;
  project?: ProjectRef | null;
}

export interface Payout {
  id: string;
  payoutNo: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  user?: PersonRef;
  earnings?: MemberEarning[];
}

/* -------------------------------- Tickets --------------------------------- */

export interface TicketMessage {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author?: { firstName: string; lastName: string } | null;
  attachments?: Attachment[];
}

export interface Ticket {
  id: string;
  ticketNo: string;
  clientId: string;
  projectId: string | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignedToId: string | null;
  createdById: string;
  resolutionSummary: string | null;
  firstResponseAt: string | null;
  lastReplyAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client?: ClientRef & { email?: string };
  assignedTo?: PersonRef | null;
  createdBy?: PersonRef | null;
  messages?: TicketMessage[];
  attachments?: Attachment[];
  _count?: { messages: number };
}

/* ------------------------------- Attachments ------------------------------ */

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  entityType: string;
  entityId: string;
  isClientVisible: boolean;
  createdAt: string;
  uploadedBy?: { firstName: string; lastName: string } | null;
}

/* ------------------------------ Notifications ----------------------------- */

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPreference {
  type: string;
  inApp: boolean;
  email: boolean;
  discord: boolean;
}

/* --------------------------------- Users ---------------------------------- */

export interface AppUser extends PersonRef {
  status: string;
  avatarId: string | null;
  lastLogin: string | null;
  createdAt: string;
  userRoles?: Array<{ role: { id: string; name: string; type: string } }>;
  roles?: AuthRole[];
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  type: string;
  isSystem: boolean;
  _count?: { users: number; permissions: number };
  permissions?: string[];
  permissionIds?: string[];
}

export interface PermissionDef {
  id: string;
  name: string;
  module: string;
  description: string | null;
}

/* -------------------------------- Dashboard ------------------------------- */

export interface DashboardMetric {
  value: string | number;
  currency?: string;
  change?: number | null;
  label?: string;
}

export interface DashboardData {
  currency?: string;
  metrics?: Record<string, DashboardMetric>;
  revenueTrend?: Array<{ label: string; invoiced?: number; received?: number; expenses?: number }>;
  cashFlow?: Array<{ label: string; inflow: number; outflow: number }>;
  projectStatus?: Array<{ status: string; count: number }>;
  recentActivity?: ActivityEntry[];
  upcomingDeadlines?: Array<{ id: string; name: string; deadline: string | null; status: string }>;
  outstandingInvoices?: Invoice[];
  topClients?: Array<{ id: string; name: string; value: number }>;
  stats?: Record<string, number>;
  [key: string]: unknown;
}

export interface ClientDashboardData {
  client?: Client;
  activeProjects?: number;
  openTickets?: number;
  outstandingBalance?: string;
  currency?: string;
  recentProjects?: Project[];
  recentInvoices?: Invoice[];
  recentActivity?: ActivityEntry[];
  [key: string]: unknown;
}

/* --------------------------------- Reports -------------------------------- */

export interface ReportRow {
  [key: string]: string | number | null | undefined;
}

export interface SearchResult {
  type: "client" | "project" | "invoice" | "quotation" | "task" | "ticket" | "lead";
  id: string;
  title: string;
  subtitle: string | null;
  link: string;
  status?: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  grouped: Record<string, SearchResult[]>;
}

/* -------------------------------- Settings -------------------------------- */

export interface CompanySettings {
  id: string;
  companyName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  taxId: string | null;
  currency: string;
  secondaryCurrency: string | null;
  exchangeRate: string | null;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
  invoicePrefix: string;
  quotationPrefix: string;
  orderPrefix: string;
  projectPrefix: string;
  taxRate: string;
  defaultAllocationModel: string;
  paymentTermsDays: number;
  maintenanceMode: boolean;
}

export interface SystemSettings {
  invoicePrefix: string;
  quotationPrefix: string;
  orderPrefix: string;
  projectPrefix: string;
  taxRate: string;
  defaultAllocationModel: string;
  paymentTermsDays: number;
  maintenanceMode: boolean;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
  runtime: {
    nodeEnv: string;
    uploadDir: string;
    maxFileSizeMb: number;
    sessionTtlHours: number;
    discordEnabled: boolean;
  };
}

export interface DiscordEventConfig {
  event: string;
  maskedUrl: string | null;
  hasWebhook: boolean;
  isEnabled: boolean;
  lastError: string | null;
}

export interface SmtpSettings {
  host: string | null;
  port: string | null;
  user: string | null;
  from: string | null;
  hasPassword: boolean;
  configured: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  module: string;
  entityId: string | null;
  ipAddress: string | null;
  details: unknown;
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string; email: string } | null;
}

/* ------------------------------ Client portal ----------------------------- */

export interface PortalProfile {
  client: Client | null;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    avatarId?: string | null;
    lastLogin?: string | null;
  };
}
