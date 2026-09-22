import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({value,onChange,required=true,minLength,autoComplete="new-password",placeholder}:{
  value:string;
  onChange:(value:string)=>void;
  required?:boolean;
  minLength?:number;
  autoComplete?:string;
  placeholder?:string;
}) {
  const [visible,setVisible]=useState(false);
  return <span className="password-control">
    <input type={visible?"text":"password"} value={value} onChange={e=>onChange(e.target.value)} required={required} minLength={minLength} autoComplete={autoComplete} placeholder={placeholder}/>
    <button type="button" className="password-visibility" onClick={()=>setVisible(v=>!v)} aria-label={visible?"Hide password":"Show password"} aria-pressed={visible}>
      {visible?<EyeOff size={17}/>:<Eye size={17}/>}<span>{visible?"Hide":"Show"}</span>
    </button>
  </span>;
}
