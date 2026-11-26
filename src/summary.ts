export type StageRecord = {
  arm: string;
  mode: string;
  repeat: string;
  stage: number;
  passed: number;
  total: number;
  escapes: number;
  durationMs: number;
  costUsd: number | null;
};

type Group = { arm: string; mode: string; stage: number; records: StageRecord[] };

const MS_PER_MIN = 60_000;

const groupKey = (record: StageRecord): string => `${record.arm}\u0000${record.mode}\u0000${record.stage}`;

export const groupRecords = (records: StageRecord[]): Group[] => {
  const groups = new Map<string, Group>();
  records.forEach((record) => {
    const group = groups.get(groupKey(record)) ?? { ...record, records: [] };
    group.records.push(record);
    groups.set(groupKey(record), group);
  });
  return [...groups.values()].sort(
    (left, right) =>
      left.arm.localeCompare(right.arm, "en") || left.mode.localeCompare(right.mode, "en") || left.stage - right.stage,
  );
};

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const range = (values: number[]): string => `${Math.min(...values)}–${Math.max(...values)}`;

const costCell = (records: StageRecord[]): string => {
  const costs = records.map((record) => record.costUsd).filter((cost): cost is number => cost !== null);
  return costs.length === records.length ? `$${mean(costs).toFixed(2)}` : "n/a";
};

const row = (group: Group): string => {
  const { records } = group;
  const allPassed = records.filter((record) => record.passed === record.total).length;
  const escapes = records.map((record) => record.escapes);
  return [
    group.arm,
    group.mode,
    String(group.stage),
    String(records.length),
    `${allPassed}/${records.length}`,
    `${mean(records.map((record) => record.passed)).toFixed(1)}/${records[0]?.total ?? 0}`,
    `${mean(escapes).toFixed(1)} (${range(escapes)})`,
    mean(records.map((record) => record.durationMs / MS_PER_MIN)).toFixed(1),
    costCell(records),
  ].join(" | ");
};

const HEADER = [
  "| Arm | Mode | Stage | Runs | Runs passing every case | Mean cases passed | Mean escape hatches (min–max) | Mean agent minutes | Mean estimated cost |",
  "|---|---|---|---|---|---|---|---|---|",
];

export const summaryTable = (records: StageRecord[]): string =>
  [...HEADER, ...groupRecords(records).map((group) => `| ${row(group)} |`)].join("\n");
