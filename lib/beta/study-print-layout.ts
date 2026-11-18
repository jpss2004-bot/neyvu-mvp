// Letter portrait, 17 mm margins. Never shrink equations below readable print.
export const studyPrintWidth=8.5*96-34*96/25.4;
export function studyMathScale(width:number,available=studyPrintWidth){
 if(!Number.isFinite(width)||width<0||!Number.isFinite(available)||available<=0)return null;
 const scale=Math.min(1,(available-2)/Math.max(1,width));
 return scale>=.85?scale:null;
}
