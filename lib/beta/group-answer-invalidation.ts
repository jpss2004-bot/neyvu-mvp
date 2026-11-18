import type {PoolClient} from 'pg';

export async function cancelCourseGroupAnswers(c:PoolClient,user:string,course:string){
 await c.query(`UPDATE schoolvault.jobs SET status='cancelled',result=NULL,error='Your course group changed. Your question is kept; ask again for updated context.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND (input->>'course_id'=$2 OR input->'group_context' @> $4::jsonb OR input->'student_context'->'courses' @> $3::jsonb OR input->'work'->'tasks' @> $4::jsonb)`,[user,course,JSON.stringify([{id:course}]),JSON.stringify([{course_id:course}])]);
}
