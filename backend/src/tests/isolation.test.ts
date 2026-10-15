import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app';
import {
  createClientWithPortalUser,
  createUser,
  listOf,
  resetDatabase,
  seedCatalogue,
  signIn,
} from './helpers';
import { prisma } from '../config/prisma';
import type { TestUser } from './helpers';

let app: Express;

const PORTAL_PERMS = [
  'portal.invoices.view',
  'portal.projects.view',
  'portal.tickets.view',
  'portal.quotations.view',
  'portal.tickets.create',
];

let alpha: { clientId: string; user: TestUser };
let beta: { clientId: string; user: TestUser };

let alphaInvoiceId: string;
let betaInvoiceId: string;
let betaProjectId: string;
let betaTicketId: string;
let betaQuotationId: string;

function seq(label: string): string {
  return `${label}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();

  alpha = await createClientWithPortalUser('Alpha', PORTAL_PERMS);
  beta = await createClientWithPortalUser('Beta', PORTAL_PERMS);

  // Records for client A (visible to its own portal user).
  const alphaInvoice = await prisma.invoice.create({
    data: { invoiceNo: seq('INV-A-'), clientId: alpha.clientId, status: 'ISSUED', total: '150.00', balance: '150.00' },
  });

  // Records for client B (must never be readable by client A).
  const betaInvoice = await prisma.invoice.create({
    data: { invoiceNo: seq('INV-B-'), clientId: beta.clientId, status: 'ISSUED', total: '999.00', balance: '999.00' },
  });
  const betaProject = await prisma.project.create({
    data: { projectNo: seq('PRJ-B-'), name: 'Beta private project', clientId: beta.clientId, status: 'IN_PROGRESS' },
  });
  const betaTicket = await prisma.ticket.create({
    data: {
      ticketNo: seq('TKT-B-'),
      clientId: beta.clientId,
      subject: 'Beta confidential ticket',
      description: 'Top secret client B detail',
    },
  });
  const betaQuotation = await prisma.quotation.create({
    data: { quotationNo: seq('QUO-B-'), clientId: beta.clientId, title: 'Beta quote', status: 'SENT' },
  });

  alphaInvoiceId = alphaInvoice.id;
  betaInvoiceId = betaInvoice.id;
  betaProjectId = betaProject.id;
  betaTicketId = betaTicket.id;
  betaQuotationId = betaQuotation.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('client isolation - a portal user cannot read another client\'s records', () => {
  it('returns 404 (not 403, not 200) for GET /api/portal/invoices/:id', async () => {
    const api = await signIn(app, alpha.user);
    const res = await api.get(`/portal/invoices/${betaInvoiceId}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    // Sanity: the same user can read its OWN invoice.
    const own = await api.get(`/portal/invoices/${alphaInvoiceId}`);
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(alphaInvoiceId);
  });

  it('returns 404 for GET /api/portal/projects/:id', async () => {
    const api = await signIn(app, alpha.user);
    const res = await api.get(`/portal/projects/${betaProjectId}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET /api/portal/tickets/:id', async () => {
    const api = await signIn(app, alpha.user);
    const res = await api.get(`/portal/tickets/${betaTicketId}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Top secret client B detail');
  });

  it('returns 404 for GET /api/portal/quotations/:id', async () => {
    const api = await signIn(app, alpha.user);
    const res = await api.get(`/portal/quotations/${betaQuotationId}`);
    expect(res.status).toBe(404);
  });
});

describe('client isolation - portal list endpoints only return the signed-in client\'s records', () => {
  it('scopes GET /api/portal/invoices to the caller', async () => {
    const api = await signIn(app, alpha.user);
    const res = await api.get('/portal/invoices');
    expect(res.status).toBe(200);
    const rows = listOf<{ id: string }>(res);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(alphaInvoiceId);
    expect(ids).not.toContain(betaInvoiceId);
  });

  it('scopes GET /api/portal/tickets to the caller', async () => {
    // Create a ticket for A so the list is non-empty for A.
    const alphaApi = await signIn(app, alpha.user);
    const created = await alphaApi.post('/portal/tickets', {
      subject: 'Alpha own ticket',
      description: 'Client A private detail',
    });
    expect(created.status).toBe(201);
    const alphaTicketId = created.body.data.id as string;

    const res = await alphaApi.get('/portal/tickets');
    expect(res.status).toBe(200);
    const ids = listOf<{ id: string }>(res).map((row) => row.id);
    expect(ids).toContain(alphaTicketId);
    expect(ids).not.toContain(betaTicketId);
  });
});

describe('client isolation - staff cannot use the portal router', () => {
  it('rejects a non-client staff user with 403 even when they hold portal permissions', async () => {
    // The portal router is gated by requireClientAccount(); staff accounts are
    // rejected outright (403 "Client portal account required") rather than being
    // able to reach any record through the portal surface.
    const staff = await createUser({ permissions: ['portal.invoices.view', 'portal.tickets.view'] });
    const api = await signIn(app, staff);

    const list = await api.get('/portal/invoices');
    expect(list.status).toBe(403);

    const detail = await api.get(`/portal/invoices/${betaInvoiceId}`);
    expect(detail.status).toBe(403);
  });
});
