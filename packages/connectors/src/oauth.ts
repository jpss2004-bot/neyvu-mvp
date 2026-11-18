// OAuth 2.0 authorization-code flow (with PKCE) shared by Canvas, Brightspace,
// Microsoft Graph and Gmail. Client IDs and secrets are never in code or git:
// each institution entry names the environment variables that hold them, and a
// missing variable means the connector is unavailable, not that it falls back.
import {createHash, randomBytes} from 'node:crypto';
import {LmsError, origin as httpsOrigin} from './read-only';

export type OAuthProvider = 'canvas' | 'brightspace' | 'microsoft' | 'google';

/** One reviewed institution record (config/connectors/institutions.json). */
export type InstitutionClient = {
  id: string;
  name: string;
  provider: OAuthProvider;
  /** LMS origin for Canvas/Brightspace (https://canvas.example.edu). */
  origin?: string;
  /** Microsoft tenant id or "organizations". */
  tenant?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes?: string[];
  /** Brightspace API versions for the LP and LE products. */
  lpVersion?: string;
  leVersion?: string;
};

export type OAuthClient = {
  provider: OAuthProvider;
  institutionId: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  extraAuthParams: Record<string, string>;
};

export type TokenSet = {accessToken: string; refreshToken: string | null; expiresAt: string | null; scope: string | null};

export const DEFAULT_SCOPES: Record<OAuthProvider, string[]> = {
  // Canvas developer keys may enforce scopes; these are the read endpoints the adapter uses.
  canvas: ['url:GET|/api/v1/users/:user_id/profile', 'url:GET|/api/v1/courses', 'url:GET|/api/v1/courses/:course_id/assignments', 'url:GET|/api/v1/courses/:course_id/pages', 'url:GET|/api/v1/courses/:course_id/pages/:url_or_id', 'url:GET|/api/v1/courses/:course_id/files'],
  brightspace: ['core:*:*', 'enrollment:orgunit:read', 'content:toc:read', 'content:topics:read', 'dropbox:folders:read'],
  microsoft: ['offline_access', 'User.Read', 'Mail.Read'],
  google: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
};

export function clientFor(inst: InstitutionClient, redirectUri: string, env: Record<string, string | undefined> = process.env): OAuthClient {
  const clientId = env[inst.clientIdEnv], clientSecret = env[inst.clientSecretEnv];
  if (!clientId || !clientSecret) throw new LmsError('configuration');
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new LmsError('configuration'); }
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost' && redirect.hostname !== '127.0.0.1') throw new LmsError('configuration');
  const scopes = inst.scopes?.length ? inst.scopes : DEFAULT_SCOPES[inst.provider];
  const base = {provider: inst.provider, institutionId: inst.id, clientId, clientSecret, scopes, redirectUri: redirect.href};
  switch (inst.provider) {
    case 'canvas': {
      const o = httpsOrigin(inst.origin + '/');
      return {...base, authorizeUrl: `${o}/login/oauth2/auth`, tokenUrl: `${o}/login/oauth2/token`, revokeUrl: `${o}/login/oauth2/token`, extraAuthParams: {}};
    }
    case 'brightspace':
      return {...base, authorizeUrl: 'https://auth.brightspace.com/oauth2/auth', tokenUrl: 'https://auth.brightspace.com/core/connect/token', revokeUrl: null, extraAuthParams: {}};
    case 'microsoft': {
      const tenant = inst.tenant || 'organizations';
      if (!/^[a-z0-9.-]{1,80}$/i.test(tenant)) throw new LmsError('configuration');
      return {...base, authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, revokeUrl: null, extraAuthParams: {response_mode: 'query'}};
    }
    case 'google':
      return {...base, authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', revokeUrl: 'https://oauth2.googleapis.com/revoke', extraAuthParams: {access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false'}};
  }
}

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  return {verifier, challenge: createHash('sha256').update(verifier).digest('base64url')};
}

export const newState = () => randomBytes(32).toString('base64url');

export function authorizationUrl(client: OAuthClient, state: string, challenge: string): string {
  const u = new URL(client.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', client.clientId);
  u.searchParams.set('redirect_uri', client.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', client.scopes.join(' '));
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(client.extraAuthParams)) u.searchParams.set(k, v);
  return u.href;
}

async function tokenRequest(client: OAuthClient, params: Record<string, string>, fetcher: typeof fetch): Promise<TokenSet> {
  const body = new URLSearchParams({...params, client_id: client.clientId, client_secret: client.clientSecret});
  const response = await fetcher(client.tokenUrl, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: body.toString(), redirect: 'error', credentials: 'omit', cache: 'no-store'})
    .catch(() => { throw new LmsError('temporary'); });
  let data: any;
  try { data = await response.json(); } catch { throw new LmsError('invalid_response'); }
  if (response.status === 400 || response.status === 401) throw new LmsError(data?.error === 'invalid_grant' ? 'reauthorize' : 'configuration');
  if (response.status >= 500) throw new LmsError('temporary');
  if (response.status !== 200 || typeof data?.access_token !== 'string' || !data.access_token || data.access_token.length > 8192) throw new LmsError('invalid_response');
  const seconds = Number(data.expires_in);
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : params.refresh_token ?? null,
    expiresAt: Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
  };
}

export function exchangeCode(client: OAuthClient, code: string, verifier: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 4096) throw new LmsError('invalid_response');
  return tokenRequest(client, {grant_type: 'authorization_code', code, redirect_uri: client.redirectUri, code_verifier: verifier}, fetcher);
}

export function refreshTokens(client: OAuthClient, refreshToken: string, fetcher: typeof fetch = fetch) {
  return tokenRequest(client, {grant_type: 'refresh_token', refresh_token: refreshToken}, fetcher);
}

/** Best-effort provider-side revocation on disconnect. Local revocation happens regardless. */
export async function revokeAtProvider(client: OAuthClient, tokens: TokenSet, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!client.revokeUrl) return false;
  try {
    if (client.provider === 'canvas') {
      const r = await fetcher(client.revokeUrl, {method: 'DELETE', headers: {Authorization: `Bearer ${tokens.accessToken}`}, redirect: 'error'});
      return r.ok;
    }
    const r = await fetcher(client.revokeUrl, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: tokens.refreshToken || tokens.accessToken}).toString(), redirect: 'error'});
    return r.ok;
  } catch { return false; }
}

export function needsRefresh(tokens: TokenSet, now = Date.now()) {
  return !!tokens.expiresAt && Date.parse(tokens.expiresAt) - now < 120_000;
}
