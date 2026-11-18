import type {ReceiptView} from './moodle-receipts';
// A saved eligible snapshot still ages in an open tab. Never promote a grade,
// submission or availability across source/activity bindings or stale captures.
export function currentReceipt(receipt:ReceiptView|null|undefined,now:Date,binding?:{version_id?:unknown;activity_url?:unknown}|null){
 const age=receipt?now.getTime()-Date.parse(receipt.observed_at):NaN;
 return !!receipt?.eligible&&['signed_in_capture','owner_snapshot'].includes(receipt.provenance)&&age>=-60000&&age<=86400000&&(!binding?.version_id||receipt.version_id===binding.version_id)&&(!binding?.activity_url||receipt.activity_url===binding.activity_url);
}
