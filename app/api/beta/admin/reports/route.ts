import {betaRoute} from '../../../../../lib/beta/api-route';
import {betaJson,betaError} from '../../../../../lib/beta/http';
import {reviewPilotReports} from '../../../../../lib/beta/pilot-reports';
export const runtime='nodejs';
async function handleGET(){try{return betaJson({reports:await reviewPilotReports()});}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);
