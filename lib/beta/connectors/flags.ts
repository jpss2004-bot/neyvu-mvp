// Workstream C feature flags. Every flag defaults off: a connector, page or
// evidence type appears only when its variable is exactly "1".
export type ConnectorKind='moodle_token'|'canvas'|'brightspace'|'outlook'|'gmail';
export const connectorFlags:Record<ConnectorKind,string>={
 moodle_token:'NEYVU_CONNECTOR_MOODLE_TOKEN',canvas:'NEYVU_CONNECTOR_CANVAS',brightspace:'NEYVU_CONNECTOR_BRIGHTSPACE',
 outlook:'NEYVU_CONNECTOR_OUTLOOK',gmail:'NEYVU_CONNECTOR_GMAIL',
};
const on=(name:string,env:Record<string,string|undefined>=process.env)=>env[name]==='1';
export const connectionsPageEnabled=(env=process.env)=>on('NEYVU_CONNECTIONS_PAGE',env);
export const connectorEnabled=(kind:ConnectorKind,env=process.env)=>connectionsPageEnabled(env)&&on(connectorFlags[kind],env);
export const institutionEvidenceEnabled=(env=process.env)=>on('NEYVU_INSTITUTION_EVIDENCE',env);
export const pdfPageCitationsEnabled=(env=process.env)=>on('NEYVU_PDF_PAGE_CITATIONS',env);
