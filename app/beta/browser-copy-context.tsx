'use client';
import {createContext,useContext} from 'react';
export type BrowserCopyLease={canWrite:()=>boolean;review:(ready:()=>string|null)=>void};
export const BrowserCopyContext=createContext<BrowserCopyLease>({canWrite:()=>true,review:()=>{}});
export const useBrowserCopies=()=>useContext(BrowserCopyContext);
