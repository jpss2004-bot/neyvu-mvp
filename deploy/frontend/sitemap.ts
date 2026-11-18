import type {MetadataRoute} from 'next';
import {pageOrigin} from '../../lib/beta/page-data';
export const dynamic='force-dynamic';
export default function sitemap():MetadataRoute.Sitemap{return [{url:new URL('/beta/join',pageOrigin()).href}];}
