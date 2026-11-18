import type {MetadataRoute} from 'next';
import {betaOrigin} from '../lib/beta/config';

export const dynamic='force-dynamic';

export default function robots():MetadataRoute.Robots{
 // Let crawlers read each page's robots metadata. Student content still requires
 // authentication and private pages retain the root layout's noindex policy.
 return {rules:{userAgent:'*',allow:'/',disallow:'/api/'},sitemap:new URL('/sitemap.xml',betaOrigin()).href};
}
