// Synthetic preview adapter. This artifact has no backend URL or credentials.
import {unavailableCapabilities} from '../../lib/beta/page-contract';
import type {StudyCopy} from '../../lib/beta/study-copy';
export function pageOrigin(){return process.env.VERCEL_URL?'https://'+process.env.VERCEL_URL:'http://127.0.0.1:3342';}
export async function pageCapabilities(){return {...unavailableCapabilities};}
export async function pageSession(){return {version:1 as const,actor:null,admin:null};}
export async function pageStudyCopy(_message:string):Promise<StudyCopy>{throw Error('Study answers are unavailable in this isolated preview');}
