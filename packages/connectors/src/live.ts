// Live Canvas and Brightspace adapters: the same read-only connectors as the
// fixtures use, built from a reviewed institution record and an OAuth access
// token held server-side. The origin always comes from the institution record,
// never from a learner-supplied URL.
import {ReadOnlyLms, row, id} from './read-only';
import {CanvasConnector} from './connectors/canvas';
import {BrightspaceConnector} from './connectors/brightspace';
import type {InstitutionClient} from './oauth';
import type {LmsConnector} from './types';
import {LmsError} from './read-only';

/** The LMS user id the token belongs to; stored on the account so later reads detect a swapped account. */
export async function lmsIdentity(inst: InstitutionClient, accessToken: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!inst.origin) throw new LmsError('configuration');
  const api = new ReadOnlyLms({origin: inst.origin, approvedOrigins: [inst.origin], accessToken, fetch: fetcher});
  if (inst.provider === 'canvas') {
    const path = '/api/v1/users/self/profile';
    return id(row((await api.get(path, path)).data).id);
  }
  if (inst.provider === 'brightspace') {
    const path = `/d2l/api/lp/${inst.lpVersion || '1.46'}/users/whoami`;
    return id(row((await api.get(path, path)).data).Identifier);
  }
  throw new LmsError('configuration');
}

export function liveLmsConnector(connectorId: string, inst: InstitutionClient, accessToken: string, identity: string, fetcher: typeof fetch = fetch): LmsConnector {
  if (!inst.origin) throw new LmsError('configuration');
  const common = {id: connectorId, origin: inst.origin, approvedOrigins: [inst.origin], accessToken, expectedIdentity: identity, fetch: fetcher};
  if (inst.provider === 'canvas') return new CanvasConnector(common);
  if (inst.provider === 'brightspace') return new BrightspaceConnector({...common, lpVersion: inst.lpVersion || '1.46', leVersion: inst.leVersion || '1.74'});
  throw new LmsError('configuration');
}
