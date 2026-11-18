import type {PoolClient} from 'pg';
import {currentCourseMemberships} from './course-membership';
import {courseGroupReports,type GroupContext} from './group-context-format';

export async function courseGroupContexts(c:PoolClient,user:string,courseIds:string[],now=new Date()):Promise<Record<string,GroupContext>>{
 const reports=(await c.query("SELECT id,course_id,chat_id,kind,body,revision,updated_at FROM schoolvault.student_memory WHERE user_id=$1 AND course_id=ANY($2::uuid[]) AND chat_id IS NULL AND kind='correction' AND body ~ '^Student-reported (lab|section|team): ' ORDER BY updated_at DESC,id DESC",[user,courseIds])).rows;
 const official=await currentCourseMemberships(c,user,courseIds,now);
 return Object.fromEntries(courseIds.map(courseId=>[courseId,{course_id:courseId,official:official[courseId],reports:courseGroupReports(courseId,reports)}]));
}
export async function courseGroupContext(c:PoolClient,user:string,courseId:string,now=new Date()):Promise<GroupContext>{
 return (await courseGroupContexts(c,user,[courseId],now))[courseId];
}
