export {proxy} from './proxy';
// Local Next servers do not implement Vercel's skipMiddlewareRequestBody.
// Their API requests use the streaming route, without middleware body cloning.
export const config={matcher:['/beta/:path*']};
