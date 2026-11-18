// Demo: one function, printCourseload(), reads every LMS through LmsConnector.
//   node src/demo.ts                 -> Canvas, then Moodle, then Brightspace
//   node src/demo.ts --only canvas   -> one provider
//   node src/demo.ts --via-mcp       -> same listing, but as an MCP client of src/mcp-server.ts
// Fixtures only: no network, no credentials, nothing written.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {connectorsFromRegistry} from './registry';
import type {LmsConnector} from './types';

const here = dirname(fileURLToPath(import.meta.url));
const registry = resolve(here, '../connectors.fixture.json');
const NAMES: Record<string, string> = {canvas: 'Canvas', moodle: 'Moodle', brightspace: 'Brightspace'};
const fmt = (iso: string | null, text: string | null) => iso ? 'due ' + iso.replace('T', ' ').replace(/:00(\.000)?(Z|[+-]\d\d:\d\d)$/, ' $2') : text ? `due "${text}" (no zone)` : 'no due date';

async function printCourseload(c: LmsConnector) {
  console.log(`\n== ${NAMES[c.provider]} · ${c.id} · ${c.origin}`);
  const courses = await c.listCourses();
  for (const course of courses.items) {
    console.log(`  ${course.code.padEnd(12)} ${course.title}   [${course.ref}]`);
    const a = await c.listAssignments(course.externalId);
    for (const x of a.items) console.log(`      - ${x.title.padEnd(36)} ${fmt(x.dueAt, x.dueText)}   ${x.provenance.contentHash.slice(0, 19)}…`);
    if (!a.items.length) console.log('      (no assignments in this source)');
  }
  for (const issue of courses.issues) console.log(`  ! ${issue}`);
}

async function viaMcp(only: string | undefined) {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve(here, 'mcp-server.ts')], {stdio: ['pipe', 'pipe', 'inherit']});
  const lines = createInterface({input: child.stdout!})[Symbol.asyncIterator]();
  let n = 0;
  const call = async (method: string, params: object) => {
    child.stdin!.write(JSON.stringify({jsonrpc: '2.0', id: ++n, method, params}) + '\n');
    const next = await lines.next();
    if (next.done) throw new Error('MCP server closed');
    const res = JSON.parse(next.value);
    if (res.error) throw new Error(res.error.message);
    return res.result;
  };
  const init = await call('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'neyvu-demo', version: '0.1.0'}});
  child.stdin!.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
  console.log(`MCP server: ${init.serverInfo.name} ${init.serverInfo.version} (protocol ${init.protocolVersion})`);
  console.log('tools:', (await call('tools/list', {})).tools.map((t: {name: string}) => t.name).join(', '));
  const courses = (await call('tools/call', {name: 'list_courses', arguments: only ? {connector: `sample-${only}`} : {}})).structuredContent;
  for (const group of courses.connectors) {
    console.log(`\n== ${NAMES[group.provider]} · ${group.connector}`);
    for (const course of group.items) {
      console.log(`  ${course.code.padEnd(12)} ${course.title}`);
      const a = (await call('tools/call', {name: 'list_assignments', arguments: {course_ref: course.ref}})).structuredContent;
      for (const x of a.items) console.log(`      - ${x.title.padEnd(36)} ${fmt(x.dueAt, x.dueText)}`);
    }
  }
  child.stdin!.end();
}

const argv = process.argv.slice(2), oi = argv.indexOf('--only'), only = oi >= 0 ? argv[oi + 1] : undefined;
if (only && !NAMES[only]) { console.error('--only must be canvas, moodle or brightspace'); process.exit(2); }
console.log('Neyvu LMS connector layer — prototype demo (synthetic fixtures, no network, nothing written)');
if (argv.includes('--via-mcp')) await viaMcp(only);
else {
  const order = ['canvas', 'moodle', 'brightspace'];
  const connectors = connectorsFromRegistry(registry).filter(c => !only || c.provider === only).sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  for (const c of connectors) await printCourseload(c);
}
