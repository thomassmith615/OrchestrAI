/**
 * Output rendering.
 *
 * Two formats, one source. Commands produce a `CommandResult`; this module
 * turns it into either aligned human output or machine readable JSON. Keeping
 * rendering here is what makes `--json` universal instead of per-command.
 */
import type { CommandResult, FieldStatus, Report } from "../engine/command.js";

const STATUS_LABELS: Record<FieldStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  info: "INFO",
};

/**
 * A status renders as an uppercase verdict. When the field also carries a
 * string detail it follows the verdict, so that `doctor` can report both a
 * judgement and the reason for it on one line.
 */
function formatValue(
  value: string | number | boolean | null,
  status: FieldStatus | undefined,
): string {
  if (status !== undefined) {
    const verdict = STATUS_LABELS[status];
    return typeof value === "string" && value.length > 0
      ? `${verdict}  ${value}`
      : verdict;
  }
  if (value === null) {
    return "-";
  }
  return String(value);
}

/**
 * Aligned `Label:  value` block. Labels are padded to a common width so that
 * status columns line up, which is what makes scanning output fast.
 */
export function renderHuman(report: Report): string {
  const width = report.fields.reduce(
    (max, field) => Math.max(max, field.label.length),
    0,
  );

  const lines = report.fields.map((field) => {
    const label = `${field.label}:`.padEnd(width + 3, " ");
    return `${label}${formatValue(field.value, field.status)}`;
  });

  if (report.notes !== undefined && report.notes.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(...report.notes);
  }

  return lines.join("\n");
}

export function renderJson(result: CommandResult): string {
  return JSON.stringify(result.data, null, 2);
}

export function render(result: CommandResult, asJson: boolean): string {
  return asJson ? renderJson(result) : renderHuman(result.report);
}
