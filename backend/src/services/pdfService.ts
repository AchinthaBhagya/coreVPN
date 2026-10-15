import PDFDocument from 'pdfkit';
import { formatMoney } from '../utils/money';

export interface InvoicePdfCompany {
  name: string;
  legalName?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  taxId?: string | null;
}

export interface InvoicePdfLine {
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

export interface InvoicePdfData {
  company: InvoicePdfCompany;
  invoice: {
    invoiceNo: string;
    issueDate: Date;
    dueDate?: Date | null;
    status: string;
    currency: string;
    subtotal: string;
    discountTotal: string;
    taxRate: string;
    taxTotal: string;
    total: string;
    amountPaid: string;
    balance: string;
    notes?: string | null;
    terms?: string | null;
    items: InvoicePdfLine[];
  };
  client: {
    name: string;
    company?: string | null;
    email?: string | null;
    address?: string | null;
    phone?: string | null;
  };
}

const BRAND = '#0e7490';
const MUTED = '#64748b';
const DARK = '#0f172a';

function formatDate(value: Date | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Renders an invoice to a PDF buffer using pdfkit. All text is drawn from
 * persisted database values - no user-supplied markup is interpreted.
 */
export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const { company, invoice, client } = data;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${invoice.invoiceNo}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const rightEdge = pageWidth - doc.page.margins.right;
      const leftEdge = doc.page.margins.left;

      // Header band
      doc.rect(0, 0, pageWidth, 96).fillColor(BRAND).fill();
      doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text(company.name, leftEdge, 30);
      doc.fontSize(9).font('Helvetica').fillColor('#dbeafe');
      const contactLine = [company.email, company.phone, company.website].filter(Boolean).join('  •  ');
      if (contactLine) doc.text(contactLine, leftEdge, 58);
      if (company.address) doc.text(company.address.replace(/\n/g, ', '), leftEdge, 71, { width: 320 });
      if (company.taxId) doc.text(`Tax ID: ${company.taxId}`, leftEdge, 71, { width: 320, align: 'right' });

      // Title block
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(26).text('INVOICE', leftEdge, 130, { align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      doc.text(`Invoice #: ${invoice.invoiceNo}`, leftEdge, 168, { align: 'right' });
      doc.text(`Issued: ${formatDate(invoice.issueDate)}`, leftEdge, 183, { align: 'right' });
      doc.text(`Due: ${formatDate(invoice.dueDate)}`, leftEdge, 198, { align: 'right' });
      doc.text(`Status: ${invoice.status}`, leftEdge, 213, { align: 'right' });

      // Bill to
      doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold').text('BILL TO', leftEdge, 130);
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(client.company || client.name, leftEdge, 146, { width: 260 });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED);
      let billY = 162;
      if (client.company && client.name) {
        doc.text(client.name, leftEdge, billY, { width: 260 });
        billY += 13;
      }
      if (client.email) { doc.text(client.email, leftEdge, billY, { width: 260 }); billY += 13; }
      if (client.phone) { doc.text(client.phone, leftEdge, billY, { width: 260 }); billY += 13; }
      if (client.address) { doc.text(client.address.replace(/\n/g, ', '), leftEdge, billY, { width: 260 }); billY += 13; }

      // Table
      let y = 260;
      const colX = { desc: leftEdge, qty: rightEdge - 250, price: rightEdge - 180, discount: rightEdge - 110, total: rightEdge - 20 };

      doc.rect(leftEdge, y - 6, rightEdge - leftEdge, 22).fillColor('#f1f5f9').fill();
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9);
      doc.text('DESCRIPTION', colX.desc + 6, y, { width: 220 });
      doc.text('QTY', colX.qty, y, { width: 55, align: 'right' });
      doc.text('UNIT', colX.price, y, { width: 60, align: 'right' });
      doc.text('DISC', colX.discount, y, { width: 60, align: 'right' });
      doc.text('AMOUNT', colX.total - 70, y, { width: 90, align: 'right' });
      y += 26;

      doc.font('Helvetica').fontSize(9).fillColor(DARK);
      for (const line of invoice.items) {
        const rowHeight = Math.max(16, doc.heightOfString(line.description, { width: 220 }) + 4);
        doc.fillColor(DARK).text(line.description, colX.desc + 6, y, { width: 220 });
        doc.fillColor(MUTED);
        doc.text(line.quantity, colX.qty, y, { width: 55, align: 'right' });
        doc.text(formatMoney(line.unitPrice, invoice.currency), colX.price - 20, y, { width: 80, align: 'right' });
        doc.text(formatMoney(line.discount, invoice.currency), colX.discount - 20, y, { width: 80, align: 'right' });
        doc.fillColor(DARK).text(formatMoney(line.lineTotal, invoice.currency), colX.total - 70, y, { width: 90, align: 'right' });
        y += rowHeight;
        if (y > doc.page.height - 200) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      }

      doc.moveTo(leftEdge, y).lineTo(rightEdge, y).strokeColor('#e2e8f0').stroke();
      y += 12;

      // Totals
      const totalsX = rightEdge - 230;
      const totalRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
        doc.fillColor(bold ? DARK : MUTED).text(label, totalsX, y, { width: 120, align: 'right' });
        doc.fillColor(DARK).text(value, totalsX + 120, y, { width: 110, align: 'right' });
        y += bold ? 20 : 15;
      };

      totalRow('Subtotal', formatMoney(invoice.subtotal, invoice.currency));
      if (Number(invoice.discountTotal) !== 0) totalRow('Discount', `-${formatMoney(invoice.discountTotal, invoice.currency)}`);
      totalRow(`Tax (${invoice.taxRate}%)`, formatMoney(invoice.taxTotal, invoice.currency));
      totalRow('Total', formatMoney(invoice.total, invoice.currency), true);
      if (Number(invoice.amountPaid) !== 0) totalRow('Amount paid', formatMoney(invoice.amountPaid, invoice.currency));
      totalRow('Balance due', formatMoney(invoice.balance, invoice.currency), true);

      // Notes
      y += 20;
      if (invoice.notes) {
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('NOTES', leftEdge, y);
        doc.font('Helvetica').fillColor(DARK).text(invoice.notes, leftEdge, y + 14, { width: 300 });
        y += 14 + doc.heightOfString(invoice.notes, { width: 300 }) + 12;
      }
      if (invoice.terms) {
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('TERMS', leftEdge, y);
        doc.font('Helvetica').fillColor(DARK).text(invoice.terms, leftEdge, y + 14, { width: 300 });
      }

      doc
        .fillColor(MUTED)
        .fontSize(8)
        .text(`${company.name} • Generated by 3xCodz Management System`, leftEdge, doc.page.height - 60, {
          width: rightEdge - leftEdge,
          align: 'center',
        });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
