import type {MetadataRoute} from 'next';
import {pageOrigin} from '../../lib/beta/page-data';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:'/api/'},sitemap:new URL('/sitemap.xml',pageOrigin()).href};}
