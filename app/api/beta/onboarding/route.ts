import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {guidedOnboardingProgress,onboardingCourseSelection,onboardingProgress} from '../../../../lib/beta/onboarding';
import {betaJson,betaError,BetaHttpError} from '../../../../lib/beta/http';
export const runtime='nodejs';
async function handleGET(request:Request){try{
 const actor=await betaActor();if(!actor||actor.demo)throw new BetaHttpError('Sign in to your student account.',401);
 const view=new URL(request.url).searchParams.get('view');
 if(view==='guided')return betaJson(await guidedOnboardingProgress(actor.id));
 if(view==='selection')return betaJson(await onboardingCourseSelection(actor.id));
 return betaJson(await onboardingProgress(actor.id));
}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);
