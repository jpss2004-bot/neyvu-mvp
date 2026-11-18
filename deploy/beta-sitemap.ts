import type {MetadataRoute} from 'next';
import {betaOrigin} from '../lib/beta/config';

export const dynamic='force-dynamic';

export default function sitemap():MetadataRoute.Sitemap{
 // Only the public marketing page belongs in discovery; never include accounts,
 // conversations, course materials, admissions callbacks or signed file URLs.
 return [{url:new URL('/beta/join',betaOrigin()).href}];
}
