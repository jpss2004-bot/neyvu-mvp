import {createHash} from 'node:crypto';

// PostgreSQL n_live_tup is an estimate. Accepting an investigated warning is
// an explicit operator decision, bound to one immutable snapshot and the exact
// warning set. This does not certify historical completeness.
export function adjudicateStatWarnings(snapshotBytes, warnings, decision, investigationBytes) {
 const sha = bytes => createHash('sha256').update(bytes).digest('hex');
 const fail = () => { throw Error('Stat-gap adjudication does not match this snapshot, investigation and exact warning set'); };
 if (!decision || decision.version !== 1 || decision.action !== 'accept_investigated_estimate_warnings'
   || decision.snapshot_sha256 !== sha(snapshotBytes) || decision.investigation_sha256 !== sha(investigationBytes)
   || typeof decision.reason !== 'string' || !decision.reason.trim()
   || typeof decision.limits !== 'string' || !decision.limits.trim()
   || !Number.isFinite(Date.parse(decision.adjudicated_at)) || !Array.isArray(decision.warnings)) fail();
 const normal = rows => {
  const seen = new Set();
  return rows.map(row => {
   if (!row || typeof row.table !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.table)
     || !Number.isSafeInteger(row.exported) || row.exported < 0
     || !Number.isSafeInteger(row.live_rows_statistic) || row.live_rows_statistic <= row.exported
     || seen.has(row.table)) fail();
   seen.add(row.table);
   return {table: row.table, exported: row.exported, live_rows_statistic: row.live_rows_statistic};
  }).sort((a, b) => a.table.localeCompare(b.table));
 };
 if (JSON.stringify(normal(warnings)) !== JSON.stringify(normal(decision.warnings))) fail();
 return {action: decision.action, adjudicated_at: decision.adjudicated_at,
  snapshot_sha256: decision.snapshot_sha256, investigation_sha256: decision.investigation_sha256,
  warnings: normal(warnings), reason: decision.reason, limits: decision.limits};
}
