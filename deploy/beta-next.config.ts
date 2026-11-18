import type {NextConfig} from 'next';
const config:NextConfig={experimental:{proxyClientMaxBodySize:1},output:'standalone',poweredByHeader:false,devIndicators:false,async rewrites(){return [{source:'/favicon.ico',destination:'/brand/neyvu-favicon.ico'}];},async headers(){return [{source:'/:path*',headers:[
 {key:'Cache-Control',value:'private, no-store'},
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Referrer-Policy',value:'no-referrer'},
 {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; form-action 'self'"},
 ]},{source:'/beta/desktop-connect',headers:[{key:'Referrer-Policy',value:'origin'},{key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; form-action 'self' http://127.0.0.1:*"}]}];}};
export default config;
