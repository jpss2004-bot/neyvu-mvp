// End-to-end over stdio: a real child process speaking newline-delimited JSON-RPC.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const SERVER = fileURLToPath(new URL('../src/mcp-server.ts', import.meta.url));

async function session(requests: (object | string)[]): Promise<any[]> {
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER], {stdio: ['pipe', 'pipe', 'pipe']});
  const out: any[] = [];
  const done = new Promise<void>(res => createInterface({input: child.stdout}).on('line', l => out.push(JSON.parse(l))).on('close', () => res()));
  for (const r of requests) child.stdin.write((typeof r === 'string' ? r : JSON.stringify(r)) + '\n');
  child.stdin.end();
  await done;
  return out;
}
const call = (id: number, name: string, args: object) => ({jsonrpc: '2.0', id, method: 'tools/call', params: {name, arguments: args}});

test('initialize negotiates a known protocol version and advertises tools', async () => {
  const [init, list] = await session([
    {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 't', version: '0'}}},
    {jsonrpc: '2.0', method: 'notifications/initialized'},
    {jsonrpc: '2.0', id: 2, method: 'tools/list'},
  ]);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ['list_courses', 'list_assignments', 'list_documents', 'get_document']);
  assert.ok(list.result.tools.every((t: any) => t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false));
});

test('one tool call lists courses from Moodle, Canvas and Brightspace together', async () => {
  const [r] = await session([call(1, 'list_courses', {})]);
  const groups = r.result.structuredContent.connectors;
  assert.deepEqual(groups.map((g: any) => g.provider), ['moodle', 'canvas', 'brightspace']);
  assert.ok(groups.every((g: any) => g.items.length > 0 && !g.error));
});

test('list_assignments and get_document work identically across providers', async () => {
  const res = await session([
    call(1, 'list_assignments', {course_ref: 'sample-canvas/101'}),
    call(2, 'list_assignments', {course_ref: 'sample-moodle/42'}),
    call(3, 'get_document', {course_ref: 'sample-canvas/101', document_id: 'page:31'}),
    call(4, 'get_document', {course_ref: 'sample-brightspace/6606', document_id: 'topic:3301'}),
    call(5, 'get_document', {course_ref: 'sample-moodle/42', document_id: 'cm:902'}),
  ]);
  assert.equal(res[0].result.structuredContent.items[0].dueAt, '2026-11-14T03:59:00Z');
  assert.equal(res[1].result.structuredContent.items[0].dueAt, '2026-11-14T23:59:00-04:00');
  for (const r of res.slice(2)) {
    const d = r.result.structuredContent.document;
    assert.equal(d.role, 'untrusted course material');
    assert.ok(d.content.length > 0);
    assert.match(d.provenance.contentHash, /^sha256:/);
    assert.equal(JSON.parse(r.result.content[0].text).document.ref, d.ref);
  }
});

test('errors are tool errors with a code, never provider text or a crash', async () => {
  const res = await session([
    call(1, 'list_assignments', {course_ref: 'sample-canvas/999'}),
    call(2, 'get_document', {course_ref: 'sample-canvas/101', document_id: '../../etc'}),
    call(3, 'list_assignments', {course_ref: 'sample-canvas/101', extra: 'x'}),
    {jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'submit_assignment', arguments: {}}},
    {jsonrpc: '2.0', id: 5, method: 'resources/write'},
    'not json',
    {jsonrpc: '2.0', id: 6, method: 'ping'},
  ]);
  assert.equal(res[0].result.isError, true); assert.equal(res[0].result.structuredContent.error, 'boundary');
  assert.equal(res[1].result.structuredContent.error, 'not_found');
  assert.equal(res[2].result.structuredContent.error, 'configuration');
  assert.equal(res[3].error.code, -32602);
  assert.equal(res[4].error.code, -32601);
  assert.equal(res[5].error.code, -32700);
  assert.deepEqual(res[6].result, {});
});
