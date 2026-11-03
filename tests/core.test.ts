import {describe,it,expect,vi} from 'vitest';
import {validateAnalyze,matchesSchema,readingSchema} from '../src/schema';
import {mockReading,mockPatterns} from '../src/mock';
import {parseResponse,mediaParts} from '../src/meta';
import worker from '../src/index';
const input=()=>({lang:'en' as const,context:{situation:'At the door'},media:[{kind:'image' as const,mime:'image/jpeg',data_b64:'/9j/2Q=='}]});
describe('validation',()=>{
 it('accepts supported image, audio and video',()=>{expect(validateAnalyze(input())).toEqual(input());for(const [kind,mime] of [['audio','audio/wav'],['audio','audio/mpeg'],['video','video/mp4']])expect(validateAnalyze({...input(),media:[{kind,mime,data_b64:'AAAA'}]}).media).toHaveLength(1);});
 it.each([{lang:'fr'},{context:{breed:15}},{media:[]},{media:[{kind:'video',mime:'video/webm',data_b64:'AAAA'}]},{media:[{kind:'image',mime:'image/jpeg',data_b64:'not base64!'}]},{media:[{kind:'toString',mime:'x',data_b64:'AAAA'}]}])('rejects malformed input %j',patch=>expect(()=>validateAnalyze({...input(),...patch})).toThrow());
 it('rejects media over the total budget',()=>expect(()=>validateAnalyze({...input(),media:[{kind:'image',mime:'image/jpeg',data_b64:'A'.repeat(21*1024*1024)}]})).toThrow('15 MB'));
 it('rejects MP4 over its own budget',()=>expect(()=>validateAnalyze({...input(),media:[{kind:'video',mime:'video/mp4',data_b64:'A'.repeat(17*1024*1024)}]})).toThrow('12 MB'));
});
describe('deterministic mocks',()=>{
 it('detects door context and preserves schema',()=>{const r=mockReading(input());expect(r.primary.label).toBe('wants_out');const {mode,...reading}=r;expect(mode).toBe('mock');expect(matchesSchema(reading,readingSchema)).toBe(true);expect(mockReading(input())).toEqual(r);expect(r.signals.bark.present).toBe(false);});
 it('flags pain in Spanish',()=>{const r=mockReading({...input(),lang:'es',context:{situation:'Mi perro cojea'}});expect(r.primary.label).toBe('pain');expect(r.vet_alert).toMatchObject({flag:true,urgency:'soon'});expect(r.dog_says).toContain('molesta');});
 it('varies by media and play context',()=>{expect(mockReading({...input(),context:{},media:[{kind:'audio',mime:'audio/wav',data_b64:'AAAA'}]}).primary.label).toBe('attention');expect(mockReading({...input(),context:{situation:'pelota'}}).primary.label).toBe('play');expect(mockPatterns('es').mode).toBe('mock');});
});
describe('Meta response parsing',()=>{
 it('reads top-level JSON',()=>expect(parseResponse({output_text:'{"ok":true}'})).toEqual({ok:true}));
 it('reads message output and fenced JSON',()=>expect(parseResponse({output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'```json\n{"ok":true}\n```'}]}]})).toEqual({ok:true}));
 it('joins split text blocks',()=>expect(parseResponse({output:[{type:'message',content:[{type:'output_text',text:'{"ok":'},{type:'output_text',text:'true}'}]}]})).toEqual({ok:true}));
 it.each([{}, {output_text:'oops'}, {output_text:'{broken}'}])('rejects unusable response',data=>expect(()=>parseResponse(data)).toThrow());
 it('rejects structurally invalid model JSON',()=>{expect(matchesSchema({},readingSchema)).toBe(false);const {mode,...reading}=mockReading(input());expect(matchesSchema({...reading,extra:1},readingSchema)).toBe(false);expect(matchesSchema({...reading,primary:{...reading.primary,confidence:2}},readingSchema)).toBe(false);});
 it('maps media to compatible parts',()=>{expect(mediaParts(input().media)[0]).toMatchObject({type:'input_image'});expect(mediaParts([{kind:'audio',mime:'audio/mpeg',data_b64:'AAAA'}])[0]).toMatchObject({input_audio:{format:'mp3'}});});
});
describe('router without network',()=>{
 const env={ASSETS:{fetch:vi.fn()} as any};
 it('reports mock health',async()=>expect(await(await worker.fetch(new Request('https://local/api/health'),env)).json()).toMatchObject({ok:true,live:false}));
 it('handles mock reading without a key',async()=>{const r=await worker.fetch(new Request('https://local/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())}),env);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({mode:'mock'});});
 it('returns 400 for malformed JSON',async()=>{const r=await worker.fetch(new Request('https://local/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{' }),env);expect(r.status).toBe(400);});
 it('forces mock even when a key is configured',async()=>{const r=await worker.fetch(new Request('https://local/api/analyze?mock=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())}),{...env,MODEL_API_KEY:'test-placeholder'});expect(await r.json()).toMatchObject({mode:'mock'});});
 it('rejects invalid pattern and card requests',async()=>{for(const path of ['patterns','card']){const r=await worker.fetch(new Request('https://local/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"lang":"en"}'}),env);expect(r.status).toBe(400);}});
});
