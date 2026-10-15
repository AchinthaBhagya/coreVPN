import { RoleType } from '@prisma/client';

export interface PermissionDef {
  name: string;
  module: string;
  description: string;
}

/**
 * Central permission catalogue. Permissions are enforced server-side on every
 * protected endpoint - hiding UI elements is never treated as authorization.
 */
export const PERMISSIONS: PermissionDef[] = [
  // Dashboard & search
  { name: 'dashboard.view', module: 'dashboard', description: 'View the business dashboard' },
  { name: 'search.global', module: 'search', description: 'Use global search / command palette' },

  // Clients
  { name: 'clients.view', module: 'clients', description: 'View clients' },
  { name: 'clients.create', module: 'clients', description: 'Create clients' },
  { name: 'clients.update', module: 'clients', description: 'Update clients' },
  { name: 'clients.delete', module: 'clients', description: 'Archive/delete clients' },
  { name: 'clients.export', module: 'clients', description: 'Export client data' },

  // Leads
  { name: 'leads.view', module: 'leads', description: 'View leads' },
  { name: 'leads.create', module: 'leads', description: 'Create leads' },
  { name: 'leads.update', module: 'leads', description: 'Update leads' },
  { name: 'leads.delete', module: 'leads', description: 'Delete leads' },
  { name: 'leads.convert', module: 'leads', description: 'Convert leads to clients' },

  // Services
  { name: 'services.view', module: 'services', description: 'View service catalogue' },
  { name: 'services.manage', module: 'services', description: 'Manage service catalogue' },

  // Quotations
  { name: 'quotations.view', module: 'quotations', description: 'View quotations' },
  { name: 'quotations.create', module: 'quotations', description: 'Create quotations' },
  { name: 'quotations.update', module: 'quotations', description: 'Update quotations' },
  { name: 'quotations.delete', module: 'quotations', description: 'Delete quotations' },
  { name: 'quotations.send', module: 'quotations', description: 'Send quotations to clients' },
  { name: 'quotations.respond', module: 'quotations', description: 'Accept or reject quotations (client)' },
  { name: 'quotations.convert', module: 'quotations', description: 'Convert quotations to projects' },

  // Orders
  { name: 'orders.view', module: 'orders', description: 'View service orders' },
  { name: 'orders.create', module: 'orders', description: 'Create service orders' },
  { name: 'orders.update', module: 'orders', description: 'Update service orders' },

  // Projects
  { name: 'projects.view', module: 'projects', description: 'View assigned projects' },
  { name: 'projects.viewAll', module: 'projects', description: 'View all projects' },
  { name: 'projects.create', module: 'projects', description: 'Create projects' },
  { name: 'projects.update', module: 'projects', description: 'Update projects' },
  { name: 'projects.delete', module: 'projects', description: 'Delete projects' },
  { name: 'projects.assign', module: 'projects', description: 'Assign project members' },

  // Tasks
  { name: 'tasks.view', module: 'tasks', description: 'View tasks' },
  { name: 'tasks.create', module: 'tasks', description: 'Create tasks' },
  { name: 'tasks.update', module: 'tasks', description: 'Update tasks' },
  { name: 'tasks.delete', module: 'tasks', description: 'Delete tasks' },
  { name: 'tasks.assign', module: 'tasks', description: 'Assign tasks to users' },

  // Time tracking
  { name: 'time.log', module: 'time', description: 'Log own time entries' },
  { name: 'time.viewAll', module: 'time', description: 'View all time entries' },
  { name: 'time.approve', module: 'time', description: 'Approve timesheets' },

  // Finance
  { name: 'finance.view', module: 'finance', description: 'View financial summaries' },
  { name: 'finance.reports', module: 'finance', description: 'View financial reports' },
  { name: 'invoices.view', module: 'invoices', description: 'View invoices' },
  { name: 'invoices.create', module: 'invoices', description: 'Create invoices' },
  { name: 'invoices.update', module: 'invoices', description: 'Update invoices' },
  { name: 'invoices.delete', module: 'invoices', description: 'Delete draft invoices' },
  { name: 'invoices.issue', module: 'invoices', description: 'Issue invoices' },
  { name: 'invoices.void', module: 'invoices', description: 'Void invoices' },
  { name: 'payments.view', module: 'payments', description: 'View payments' },
  { name: 'payments.record', module: 'payments', description: 'Record payments' },
  { name: 'payments.void', module: 'payments', description: 'Void payments' },
  { name: 'refunds.manage', module: 'refunds', description: 'Create refunds and credit notes' },
  { name: 'expenses.view', module: 'expenses', description: 'View expenses' },
  { name: 'expenses.create', module: 'expenses', description: 'Create expenses' },
  { name: 'expenses.update', module: 'expenses', description: 'Update expenses' },
  { name: 'expenses.approve', module: 'expenses', description: 'Approve expenses' },
  { name: 'expenses.delete', module: 'expenses', description: 'Delete expenses' },

  // Profit allocation
  { name: 'allocations.view', module: 'allocations', description: 'View allocation rules and previews' },
  { name: 'allocations.manage', module: 'allocations', description: 'Create/update allocation rules' },
  { name: 'allocations.approve', module: 'allocations', description: 'Approve member earnings' },
  { name: 'earnings.viewOwn', module: 'earnings', description: 'View own earnings' },
  { name: 'earnings.viewAll', module: 'earnings', description: 'View all member earnings' },
  { name: 'payouts.view', module: 'payouts', description: 'View payouts' },
  { name: 'payouts.manage', module: 'payouts', description: 'Create payouts' },
  { name: 'payouts.approve', module: 'payouts', description: 'Approve/mark payouts paid' },

  // Tickets
  { name: 'tickets.view', module: 'tickets', description: 'View own tickets' },
  { name: 'tickets.viewAll', module: 'tickets', description: 'View all tickets' },
  { name: 'tickets.create', module: 'tickets', description: 'Create tickets' },
  { name: 'tickets.update', module: 'tickets', description: 'Update tickets' },
  { name: 'tickets.assign', module: 'tickets', description: 'Assign tickets' },
  { name: 'tickets.close', module: 'tickets', description: 'Resolve/close tickets' },

  // Files
  { name: 'attachments.view', module: 'attachments', description: 'View attachments' },
  { name: 'attachments.upload', module: 'attachments', description: 'Upload attachments' },
  { name: 'attachments.delete', module: 'attachments', description: 'Delete attachments' },

  // Notifications
  { name: 'notifications.manage', module: 'notifications', description: 'Manage notification preferences' },

  // Administration
  { name: 'users.view', module: 'users', description: 'View users' },
  { name: 'users.create', module: 'users', description: 'Create users' },
  { name: 'users.update', module: 'users', description: 'Update users' },
  { name: 'users.delete', module: 'users', description: 'Deactivate/delete users' },
  { name: 'roles.view', module: 'roles', description: 'View roles' },
  { name: 'roles.manage', module: 'roles', description: 'Manage roles and permissions' },
  { name: 'settings.view', module: 'settings', description: 'View settings' },
  { name: 'settings.company', module: 'settings', description: 'Manage company settings' },
  { name: 'settings.integrations', module: 'settings', description: 'Manage integrations (Discord, SMTP)' },
  { name: 'settings.system', module: 'settings', description: 'Manage system settings and maintenance mode' },
  { name: 'audit.view', module: 'audit', description: 'View the audit log' },
  { name: 'reports.view', module: 'reports', description: 'View reports' },
  { name: 'reports.finance', module: 'reports', description: 'View financial reports' },
  { name: 'reports.team', module: 'reports', description: 'View team/timesheet reports' },

  // Client portal
  { name: 'portal.projects.view', module: 'portal', description: 'Portal: view own projects' },
  { name: 'portal.quotations.view', module: 'portal', description: 'Portal: view own quotations' },
  { name: 'portal.quotations.respond', module: 'portal', description: 'Portal: accept or reject own quotations' },
  { name: 'portal.invoices.view', module: 'portal', description: 'Portal: view own invoices' },
  { name: 'portal.tickets.view', module: 'portal', description: 'Portal: view own tickets' },
  { name: 'portal.tickets.create', module: 'portal', description: 'Portal: create support tickets' },
  { name: 'portal.tickets.update', module: 'portal', description: 'Portal: reply to own support tickets' },
  { name: 'portal.uploads.create', module: 'portal', description: 'Portal: upload files' },
  { name: 'portal.profile.update', module: 'portal', description: 'Portal: update own profile' },
];

export const ALL_PERMISSION_NAMES = PERMISSIONS.map((p) => p.name);

const P = (names: string[]) => names;

/** Default role templates. Owners may create additional custom roles. */
export const ROLE_TEMPLATES: Array<{
  name: string;
  type: RoleType;
  description: string;
  permissions: string[];
}> = [
  {
    name: 'Owner',
    type: RoleType.OWNER,
    description: 'Full business access including security, finance and integrations',
    permissions: ALL_PERMISSION_NAMES,
  },
  {
    name: 'Administrator',
    type: RoleType.ADMIN,
    description: 'Management access across operations based on assigned permissions',
    permissions: P([
      'dashboard.view', 'search.global',
      'clients.view', 'clients.create', 'clients.update', 'clients.delete', 'clients.export',
      'leads.view', 'leads.create', 'leads.update', 'leads.delete', 'leads.convert',
      'services.view', 'services.manage',
      'quotations.view', 'quotations.create', 'quotations.update', 'quotations.delete', 'quotations.send', 'quotations.convert',
      'orders.view', 'orders.create', 'orders.update',
      'projects.view', 'projects.viewAll', 'projects.create', 'projects.update', 'projects.assign',
      'tasks.view', 'tasks.create', 'tasks.update', 'tasks.delete', 'tasks.assign',
      'time.log', 'time.viewAll', 'time.approve',
      'finance.view', 'invoices.view', 'invoices.create', 'invoices.update', 'invoices.issue',
      'payments.view', 'payments.record', 'expenses.view', 'expenses.create', 'expenses.update', 'expenses.approve',
      'allocations.view', 'earnings.viewAll', 'payouts.view',
      'tickets.view', 'tickets.viewAll', 'tickets.create', 'tickets.update', 'tickets.assign', 'tickets.close',
      'attachments.view', 'attachments.upload', 'attachments.delete', 'notifications.manage',
      'users.view', 'users.create', 'users.update', 'roles.view', 'settings.view',
      'reports.view', 'reports.team',
    ]),
  },
  {
    name: 'Project Manager',
    type: RoleType.PROJECT_MANAGER,
    description: 'Projects, tasks, assignments, deadlines and client communication',
    permissions: P([
      'dashboard.view', 'search.global',
      'clients.view', 'clients.update',
      'leads.view', 'leads.create', 'leads.update',
      'services.view',
      'quotations.view', 'quotations.create', 'quotations.update', 'quotations.send', 'quotations.convert',
      'orders.view', 'orders.create', 'orders.update',
      'projects.view', 'projects.viewAll', 'projects.create', 'projects.update', 'projects.assign',
      'tasks.view', 'tasks.create', 'tasks.update', 'tasks.delete', 'tasks.assign',
      'time.log', 'time.viewAll', 'time.approve',
      'invoices.view', 'payments.view', 'expenses.view', 'expenses.create',
      'tickets.view', 'tickets.viewAll', 'tickets.create', 'tickets.update', 'tickets.assign', 'tickets.close',
      'attachments.view', 'attachments.upload', 'notifications.manage',
      'reports.view', 'reports.team', 'users.view',
    ]),
  },
  {
    name: 'Developer',
    type: RoleType.DEVELOPER,
    description: 'Assigned development projects, tasks, time tracking and deliverables',
    permissions: P([
      'dashboard.view', 'search.global',
      'clients.view', 'services.view',
      'projects.view', 'tasks.view', 'tasks.update', 'time.log',
      'attachments.view', 'attachments.upload', 'notifications.manage',
      'earnings.viewOwn', 'tickets.view', 'tickets.update',
    ]),
  },
  {
    name: 'Designer',
    type: RoleType.DESIGNER,
    description: 'Design projects, assigned tasks, assets and deliverables',
    permissions: P([
      'dashboard.view', 'search.global',
      'clients.view', 'services.view',
      'projects.view', 'tasks.view', 'tasks.update', 'time.log',
      'attachments.view', 'attachments.upload', 'notifications.manage',
      'earnings.viewOwn', 'tickets.view', 'tickets.update',
    ]),
  },
  {
    name: 'Creative Member',
    type: RoleType.CREATIVE,
    description: 'Assigned creative work and deliverables (editing, branding, video)',
    permissions: P([
      'dashboard.view', 'search.global',
      'projects.view', 'tasks.view', 'tasks.update', 'time.log',
      'attachments.view', 'attachments.upload', 'notifications.manage', 'earnings.viewOwn',
    ]),
  },
  {
    name: 'Finance Manager',
    type: RoleType.FINANCE_MANAGER,
    description: 'Approved finance, expenses, invoices, payments and reports',
    permissions: P([
      'dashboard.view', 'search.global',
      'clients.view', 'clients.export',
      'quotations.view', 'quotations.update',
      'orders.view', 'projects.view', 'projects.viewAll',
      'finance.view', 'finance.reports',
      'invoices.view', 'invoices.create', 'invoices.update', 'invoices.issue', 'invoices.void', 'invoices.delete',
      'payments.view', 'payments.record', 'payments.void', 'refunds.manage',
      'expenses.view', 'expenses.create', 'expenses.update', 'expenses.approve', 'expenses.delete',
      'allocations.view', 'allocations.manage', 'allocations.approve',
      'earnings.viewAll', 'payouts.view', 'payouts.manage', 'payouts.approve',
      'attachments.view', 'attachments.upload', 'notifications.manage',
      'reports.view', 'reports.finance',
    ]),
  },
  {
    name: 'Support Agent',
    type: RoleType.SUPPORT_AGENT,
    description: 'Assigned support tickets and permitted client information',
    permissions: P([
      'dashboard.view', 'search.global',
      'clients.view', 'projects.view',
      'tickets.view', 'tickets.viewAll', 'tickets.create', 'tickets.update', 'tickets.assign', 'tickets.close',
      'attachments.view', 'attachments.upload', 'notifications.manage',
    ]),
  },
  {
    name: 'Client',
    type: RoleType.CLIENT,
    description: 'Client portal access limited to that client\'s own records',
    permissions: P([
      'portal.projects.view', 'portal.quotations.view', 'portal.quotations.respond',
      'portal.invoices.view', 'portal.tickets.view', 'portal.tickets.create',
      'portal.tickets.update', 'portal.uploads.create', 'portal.profile.update',
    ]),
  },
];

export function permissionSetForRoleTemplates(): Record<string, string[]> {
  return ROLE_TEMPLATES.reduce<Record<string, string[]>>((acc, role) => {
    acc[role.name] = role.permissions;
    return acc;
  }, {});
}
