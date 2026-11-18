// A fetch replacement that behaves like a Moodle site's mobile web service,
// answering only from a synthetic fixture. It refuses any function, path or
// method it does not know, so tests prove the connector stays read-only.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export type MoodleFixture = {
  site: string;
  token: string;
  login: {username: string; password: string};
  publicConfig: Record<string, unknown>;
  functions: Record<string, Record<string, unknown>>;
  files: Record<string, {mime: string; text: string}>;
};

export type MockLog = {method: string; path: string; fn?: string}[];

export const loadMoodleFixture = (path: string): MoodleFixture => JSON.parse(readFileSync(path, 'utf8'));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export function moodleMockFetch(f: MoodleFixture, log: MockLog = [], opts: {revoked?: () => boolean} = {}): typeof fetch {
  const base = new URL(f.site);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.slice(base.pathname.length - 1);
    if (url.origin !== base.origin) throw new Error('moodle mock: foreign origin');
    if (method === 'GET' && path.startsWith('/webservice/pluginfile.php/')) {
      log.push({method, path});
      if (url.searchParams.get('token') !== f.token || opts.revoked?.()) return json({error: 'Invalid token', errorcode: 'invalidtoken'}, 403);
      const file = f.files[path];
      if (!file) return new Response('not found', {status: 404});
      return new Response(file.text, {status: 200, headers: {'content-type': file.mime}});
    }
    if (method !== 'POST') throw new Error(`moodle mock: ${method} ${path} refused`);
    const body = new URLSearchParams(String(init?.body ?? ''));
    if (path === '/lib/ajax/service-nologin.php') {
      log.push({method, path, fn: 'tool_mobile_get_public_config'});
      return json([{error: false, data: f.publicConfig}]);
    }
    if (path === '/login/token.php') {
      log.push({method, path});
      if (body.get('service') !== 'moodle_mobile_app') return json({error: 'Service not available', errorcode: 'servicenotavailable'});
      if (body.get('username') !== f.login.username || body.get('password') !== f.login.password) return json({error: 'Invalid login', errorcode: 'invalidlogin'});
      return json({token: f.token, privatetoken: createHash('sha1').update('private').digest('hex')});
    }
    if (path !== '/webservice/rest/server.php') throw new Error(`moodle mock: path ${path} refused`);
    const fn = body.get('wsfunction') || '';
    log.push({method, path, fn});
    if (body.get('wstoken') !== f.token || opts.revoked?.()) return json({exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found'});
    const table = f.functions[fn];
    if (!table) return json({exception: 'dml_missing_record_exception', errorcode: 'invalidrecord', message: 'Can not find data record in database table external_functions.'});
    for (const [key, value] of Object.entries(table)) {
      if (key === 'default') continue;
      const [k, v] = key.split('=');
      if (body.get(k) === v) return json(value);
    }
    if ('default' in table) return json(table.default);
    return json({exception: 'invalid_parameter_exception', errorcode: 'invalidparameter', message: 'Invalid parameter value detected'});
  }) as typeof fetch;
}

/** Build the callback Moodle's launch.php would redirect to after SSO. */
export function moodleSsoCallbackFor(f: MoodleFixture, passport: string, scheme = 'neyvu') {
  const signature = createHash('md5').update(f.site.replace(/\/$/, '') + passport).digest('hex');
  return `${scheme}://token=` + Buffer.from(`${signature}:::${f.token}:::privatefixture`).toString('base64');
}
