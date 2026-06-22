// Phase 6.5: a tiny RFC-4180 CSV serializer for the client-side subscribers export. The seller is
// downloading their own already-loaded rows, so there's no server round-trip and no new PII surface.
// Quote a field only when it contains a comma, double-quote, or newline, and double any interior
// quotes — the minimal escaping that keeps Excel/Sheets/Numbers happy.

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string;
};

function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const lines = [
    columns.map((c) => escapeField(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => escapeField(c.value(row))).join(","))
  ];
  return lines.join("\r\n");
}
