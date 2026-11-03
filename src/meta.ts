import {SYSTEM} from './prompts';
import type {AnalyzeInput} from './schema';
export const MODEL='muse-spark-1.3';
export function parseResponse(data:any):unknown {
 const text=data.output_text ?? data.output?.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
 if(typeof text!=='string')throw new Error('Missing response text');
 try{return JSON.parse(text);}catch{const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start<0||end<start)throw new Error('Invalid JSON');return JSON.parse(text.slice(start,end+1));}
}
export function mediaParts(media:AnalyzeInput['media']){return media.map(m=>m.kind==='image'?{type:'input_image',image_url:`data:${m.mime};base64,${m.data_b64}`}:m.kind==='video'?{type:'input_video',video_url:`data:video/mp4;base64,${m.data_b64}`}:{type:'input_audio',input_audio:{data:m.data_b64,format:m.mime==='audio/wav'?'wav':'mp3'}});}
export async function structured(key:string,prompt:string,schema:unknown,parts:unknown[]=[]) {
 const r=await fetch('https://api.meta.ai/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,instructions:SYSTEM,input:[{type:'message',role:'user',content:[{type:'input_text',text:prompt},...parts]}],text:{format:{type:'json_schema',name:'dog_reading',strict:true,schema}},reasoning:{effort:'low'}}),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error('Model unavailable');return parseResponse(await r.json());
}
export async function imageCard(key:string,prompt:string){
 const r=await fetch('https://api.meta.ai/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'muse-image-1.0',prompt,size:'1024x1024',response_format:'b64_json',output_format:'png'}),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error('Image unavailable');const data=await r.json() as any;if(typeof data.data?.[0]?.b64_json!=='string')throw new Error('Missing image');return data.data[0].b64_json;
}
