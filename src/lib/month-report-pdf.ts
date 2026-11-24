import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Relatório mensal de reservas pagas em PDF (painel da atendente).

export interface MonthReservation {
  reservation_code: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  num_pilots: number;
  battery_type: string;
  valor_total: number;
  payment_method: string | null;
  attendance_status: 'present' | 'absent' | null;
  created_at: string | null;
  time_slot: { date: string; start_time: string; tracks: { name: string } | null };
}

const PDF_HEADER = [
  'Data', 'Horário', 'Código', 'Cliente', 'Telefone', 'E-mail', 'Pilotos',
  'Bateria', 'Pista', 'Valor (R$)', 'Pagamento', 'Presença', 'Reservado em',
];

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthRows(rows: MonthReservation[]): string[][] {
  return rows.map((r) => [
    // Meio-dia evita voltar um dia por causa do fuso.
    format(new Date(`${r.time_slot.date}T12:00:00`), 'dd/MM/yyyy'),
    r.time_slot.start_time.slice(0, 5),
    r.reservation_code ?? '',
    r.customer_name ?? '',
    r.customer_phone ?? '',
    r.customer_email ?? '',
    String(r.num_pilots),
    r.battery_type === 'kids' ? 'Kids' : 'Individual',
    r.time_slot.tracks?.name ?? '',
    formatBRL(Number(r.valor_total ?? 0)),
    paymentMethodLabel(r.payment_method),
    r.attendance_status === 'present' ? 'Presente' : r.attendance_status === 'absent' ? 'Faltou' : 'Pendente',
    r.created_at ? format(new Date(r.created_at), 'dd/MM/yyyy HH:mm') : '',
  ]);
}

// jsPDF é carregado só na hora do download, pra não pesar o painel.
export async function buildMonthPdf(rows: MonthReservation[], monthDate: Date): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const monthLabel = format(monthDate, "MMMM 'de' yyyy", { locale: ptBR });

  const totalPilots = rows.reduce((sum, r) => sum + (r.num_pilots || 0), 0);
  const totalValue = rows.reduce((sum, r) => sum + Number(r.valor_total || 0), 0);
  const present = rows.filter((r) => r.attendance_status === 'present').length;
  const absent = rows.filter((r) => r.attendance_status === 'absent').length;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Reservas do mês — Nacional Kart Indoor (Goiânia – Shopping Cerrado)', 10, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)} · Somente reservas pagas · Gerado em ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
    10,
    18,
  );
  doc.text(
    `Reservas: ${rows.length}   ·   Pilotos: ${totalPilots}   ·   Valor total: R$ ${formatBRL(totalValue)}   ·   Presentes: ${present}   ·   Faltaram: ${absent}   ·   Pendentes: ${rows.length - present - absent}`,
    10,
    23,
  );

  autoTable(doc, {
    startY: 27,
    head: [PDF_HEADER],
    body: monthRows(rows),
    margin: { left: 10, right: 10, bottom: 12 },
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 245, 250] },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 18 },
      4: { cellWidth: 24 },
      6: { cellWidth: 11, halign: 'center' },
      7: { cellWidth: 15 },
      8: { cellWidth: 26 },
      9: { cellWidth: 17, halign: 'right' },
      10: { cellWidth: 16 },
      11: { cellWidth: 16 },
      12: { cellWidth: 22 },
    },
    didDrawPage: () => {
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - 10, pageHeight - 5, { align: 'right' });
      doc.setTextColor(0);
    },
  });

  return doc.output('blob');
}


function paymentMethodLabel(method: string | null): string {
  if (method === 'PIX') return 'PIX';
  if (method === 'CREDIT_CARD' || method === 'DEBIT_CARD') return 'Cartão';
  if (method === 'BOLETO') return 'Boleto';
  return '—';
}
