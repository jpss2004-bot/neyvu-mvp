export type SignInReason='pending'|'declined'|'suspended'|'unapproved'|'admin'|'review'|'expired'|'rate'|'cancelled'|'unavailable';
// Only application-owned reasons cross the redirect boundary. Raw provider/DB errors do not.
export class SignInFailure extends Error{
 constructor(public reason:SignInReason,message:string){super(message);}
}
export function signInFailureCode(error:unknown){return error instanceof SignInFailure?'signin-'+error.reason:'signin';}
type Notice={message:string;action?:{href:string;label:string}};
const notices:Record<SignInReason,Notice>={
 pending:{message:'Your access request is waiting for review. Sign in with the same Google account after the Neyvu owner approves it. Repeating the request will not speed up approval.'},
 declined:{message:'Your access request was declined. Repeating the request will not change the decision. Contact the person who invited you to ask for a review.'},
 suspended:{message:'Access for this Google account is suspended. Contact the person who invited you. Your saved study material is kept.'},
 unapproved:{message:'This Google account has not been approved for Neyvu. Choose the exact account that was approved, or request access with the account you intend to use.',action:{href:'/beta/join#request-access',label:'Request access'}},
 admin:{message:'This is an administrator account. Use the separate administrator sign-in page.',action:{href:'/beta/admin',label:'Open administrator sign-in'}},
 review:{message:'Neyvu needs an account review before it can sign you in. Contact the person who invited you; a new access request will not repair this account.'},
 expired:{message:'This sign-in attempt expired or was already used. Continue with Google again and finish in the same browser.'},
 rate:{message:'Too many sign-in attempts. Wait before continuing with Google again. If this keeps happening, contact the person who invited you.'},
 cancelled:{message:'Google sign-in was cancelled. Continue with Google when you are ready and choose your approved account.'},
 unavailable:{message:'Google sign-in is temporarily unavailable. Try again later. Your saved study material is kept.'},
};
const fallback:Notice={message:'Sign-in could not finish. Use the Google account approved for Neyvu. If you haven’t been approved, request access below.'};
export function signInNotice(code:unknown):Notice{
 const reason=typeof code==='string'&&code.startsWith('signin-')?code.slice(7):'';
 return Object.hasOwn(notices,reason)?notices[reason as SignInReason]:fallback;
}
