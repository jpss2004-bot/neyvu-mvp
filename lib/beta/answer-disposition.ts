// Exact result from the installed example-provenance guard. Ordinary refusals,
// quotations of this text and normal academic answers retain their own behavior.
// Prefer a versioned outcome field when the worker contract is next qualified.
export const withheldExampleMessage='I could not verify the example attributed to your saved material, so I have not included that answer. Add the relevant reading passage, or ask for a clearly labelled hypothetical example and general explanation.';
export function isWithheldExample(text:string){
 return text.trim()===withheldExampleMessage;
}
export const sourceRecoveryFollowup='Please answer my previous question using only what the supplied passages support. Clearly separate any general explanation and label a created example "Illustrative example (AI-written)". If a source detail is missing, keep that limitation specific and continue with the supported parts.';
