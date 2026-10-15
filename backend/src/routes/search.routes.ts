import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { sendSuccess } from '../utils/apiResponse';
import { authenticate, AuthRequest } from '../middleware/auth';
import { denyClients, hasPermission, requirePermission } from '../middleware/authorize';
import { ah } from './helpers';

export const searchRouter = Router();

searchRouter.use(authenticate, denyClients());

export interface SearchResult {
  type: 'client' | 'project' | 'invoice' | 'quotation' | 'task' | 'ticket' | 'lead';
  id: string;
  title: string;
  subtitle: string | null;
  link: string;
  status?: string | null;
}

const PER_TYPE_LIMIT = 5;

function clientLabel(client: { companyName: string | null; firstName: string; lastName: string }): string {
  return client.companyName || `${client.firstName} ${client.lastName}`;
}

/**
 * Global search / command palette source. Results are permission-aware and
 * project-list scoped so a user never discovers records they cannot open.
 */
searchRouter.get(
  '/',
  requirePermission('search.global'),
  ah(async (req: AuthRequest, res) => {
    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (term.length < 2) {
      return sendSuccess(res, { query: term, results: [], grouped: {} });
    }

    const canViewAllProjects = hasPermission(req.user, 'projects.viewAll');
    const projectWhere: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(canViewAllProjects
        ? {}
        : { OR: [{ managerId: req.user!.id }, { members: { some: { userId: req.user!.id } } }] }),
    };

    const [clients, projects, invoices, quotations, tasks, tickets, leads] = await Promise.all([
      hasPermission(req.user, 'clients.view')
        ? prisma.client.findMany({
            where: {
              deletedAt: null,
              OR: [
                { companyName: { contains: term } },
                { firstName: { contains: term } },
                { lastName: { contains: term } },
                { email: { contains: term } },
              ],
            },
            select: { id: true, companyName: true, firstName: true, lastName: true, email: true, status: true },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
      hasPermission(req.user, 'projects.view')
        ? prisma.project.findMany({
            where: {
              AND: [
                projectWhere,
                { OR: [{ name: { contains: term } }, { projectNo: { contains: term } }] },
              ],
            },
            select: {
              id: true, projectNo: true, name: true, status: true,
              client: { select: { companyName: true, firstName: true, lastName: true } },
            },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
      hasPermission(req.user, 'invoices.view')
        ? prisma.invoice.findMany({
            where: { invoiceNo: { contains: term } },
            select: {
              id: true, invoiceNo: true, total: true, currency: true, status: true,
              client: { select: { companyName: true, firstName: true, lastName: true } },
            },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
      hasPermission(req.user, 'quotations.view')
        ? prisma.quotation.findMany({
            where: { OR: [{ quotationNo: { contains: term } }, { title: { contains: term } }] },
            select: {
              id: true, quotationNo: true, title: true, status: true,
              client: { select: { companyName: true, firstName: true, lastName: true } },
            },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
      hasPermission(req.user, 'tasks.view')
        ? prisma.task.findMany({
            where: {
              deletedAt: null,
              title: { contains: term },
              ...(canViewAllProjects
                ? {}
                : { OR: [{ assigneeId: req.user!.id }, { project: projectWhere }] }),
            },
            select: { id: true, title: true, status: true, project: { select: { name: true } } },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
      hasPermission(req.user, 'tickets.view')
        ? prisma.ticket.findMany({
            where: {
              AND: [
                { OR: [{ ticketNo: { contains: term } }, { subject: { contains: term } }] },
                ...(hasPermission(req.user, 'tickets.viewAll')
                  ? []
                  : [{ OR: [{ createdById: req.user!.id }, { assignedToId: req.user!.id }] }]),
              ],
            },
            select: {
              id: true, ticketNo: true, subject: true, status: true,
              client: { select: { companyName: true, firstName: true, lastName: true } },
            },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
      hasPermission(req.user, 'leads.view')
        ? prisma.lead.findMany({
            where: {
              OR: [
                { companyName: { contains: term } },
                { firstName: { contains: term } },
                { lastName: { contains: term } },
                { email: { contains: term } },
              ],
            },
            select: { id: true, companyName: true, firstName: true, lastName: true, email: true, status: true },
            take: PER_TYPE_LIMIT,
          })
        : Promise.resolve([]),
    ]);

    const results: SearchResult[] = [
      ...clients.map<SearchResult>((row) => ({
        type: 'client',
        id: row.id,
        title: clientLabel(row),
        subtitle: row.email,
        link: `/clients/${row.id}`,
        status: row.status,
      })),
      ...projects.map<SearchResult>((row) => ({
        type: 'project',
        id: row.id,
        title: row.name,
        subtitle: `${row.projectNo} - ${clientLabel(row.client)}`,
        link: `/projects/${row.id}`,
        status: row.status,
      })),
      ...invoices.map<SearchResult>((row) => ({
        type: 'invoice',
        id: row.id,
        title: row.invoiceNo,
        subtitle: `${clientLabel(row.client)} - ${row.currency} ${row.total.toString()}`,
        link: `/invoices/${row.id}`,
        status: row.status,
      })),
      ...quotations.map<SearchResult>((row) => ({
        type: 'quotation',
        id: row.id,
        title: `${row.quotationNo} - ${row.title}`,
        subtitle: clientLabel(row.client),
        link: `/quotations/${row.id}`,
        status: row.status,
      })),
      ...tasks.map<SearchResult>((row) => ({
        type: 'task',
        id: row.id,
        title: row.title,
        subtitle: row.project?.name ?? null,
        link: `/tasks/${row.id}`,
        status: row.status,
      })),
      ...tickets.map<SearchResult>((row) => ({
        type: 'ticket',
        id: row.id,
        title: `${row.ticketNo} - ${row.subject}`,
        subtitle: clientLabel(row.client),
        link: `/tickets/${row.id}`,
        status: row.status,
      })),
      ...leads.map<SearchResult>((row) => ({
        type: 'lead',
        id: row.id,
        title: row.companyName || `${row.firstName} ${row.lastName}`,
        subtitle: row.email,
        link: `/leads/${row.id}`,
        status: row.status,
      })),
    ];

    const grouped = results.reduce<Record<string, SearchResult[]>>((acc, item) => {
      (acc[item.type] ??= []).push(item);
      return acc;
    }, {});

    return sendSuccess(res, { query: term, results, grouped });
  }),
);
