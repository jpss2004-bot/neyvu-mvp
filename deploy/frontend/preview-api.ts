export function GET(){return Response.json({error:'Isolated preview: no student data, email or persistence.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
export const POST=GET;
export const PUT=GET;
export const PATCH=GET;
export const DELETE=GET;
