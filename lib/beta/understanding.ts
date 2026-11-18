import {tenant} from './db';
import {assessmentClaims,reconcileAssessments} from './assessments';
import {instructorAsks} from './instructor-asks';
// Quoted dated assessments and instructor asks for Today, read in one tenant transaction.
export async function betaUnderstanding(user:string,now=new Date()){
 return tenant(user,async c=>({assessments:reconcileAssessments(await assessmentClaims(c,user)),asks:await instructorAsks(c,user,now)}));
}
