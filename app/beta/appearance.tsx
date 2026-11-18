"use client";
import {useI18n} from "./language";

import {usePresentation} from './use-presentation';
export default function Appearance(){
 const {t:ui}=useI18n();
 const {preferences,update}=usePresentation();
 return <label className="beta-appearance"><span>{ui("Appearance")}</span><select aria-label={ui("Appearance")} value={preferences.appearance} onChange={event=>update({appearance:event.target.value as typeof preferences.appearance})}><option value="black">{ui("Dark")}</option><option value="light">{ui("Light")}</option><option value="system">{ui("System")}</option></select></label>;
}
