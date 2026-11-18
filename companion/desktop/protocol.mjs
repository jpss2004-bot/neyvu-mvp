import {createRequire} from 'node:module';
// Show the actual packaged build without changing protocol compatibility.
export const RELEASE=createRequire(import.meta.url)('./package.json').version;
export const PROTOCOL=3;
export const SCHEMA=18;
export const identityKey=value=>typeof value==='string'?value.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·.*)?$/)?.[1]||value:value;
