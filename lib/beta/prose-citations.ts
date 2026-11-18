// Source markers counted only in prose. The answer renderer never turns [n] inside code into a
// citation (app/components/Markdown.tsx), so arr[0] in a code answer must not fail the range check.
// Matches scripts/citecheck.py CODE: fenced blocks (closed, or running to the end) and inline spans.
const CODE=/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))|`[^`\n]+`/gm;
export function citationNumbers(text:string){return [...text.replace(CODE,'').matchAll(/\[(\d+)\]/g)].map(match=>Number(match[1]));}
