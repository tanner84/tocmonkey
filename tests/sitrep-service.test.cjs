const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const load=Module._load;
const values=new Map();
let calls=0, fail=false;
const store={get:async key=>values.get(key)||null,setJSON:async(key,value)=>values.set(key,value)};
Module._load=function(name,...args){
 if(name==='@netlify/blobs')return {getStore:()=>store,getDeployStore:()=>store};
 if(name==='./_openai')return {DEFAULT_MODEL:'configured-model',generateText:async()=>{calls++;if(fail)throw new Error('Simulated provider outage');return {text:'SITUATION\nSourced assessment\nASSESSMENT\nLimited evidence\nSOURCES\nhttps://example.org/taiwan',model:'configured-model'};}};
 return load.call(this,name,...args);
};
const service=require('../netlify/functions/_sitrep-service.js');
Module._load=load;
global.Netlify={env:{get:()=>undefined}};
global.fetch=async()=>new Response(JSON.stringify([
 {title:'Taiwan announces air defense exercise',url:'https://example.org/taiwan',pubDate:new Date().toISOString()},
 {title:'Bolivia military base explosion',cocom:'INDOPACOM',url:'https://example.org/bolivia',pubDate:new Date().toISOString()}
]),{headers:{'Content-Type':'application/json'}});
const cached=(mode,hours)=>({mode,text:'Earlier report',ts:Date.now()-hours*3600000,policyVersion:service.POLICY_VERSION});
test('source-only cache is retried instead of treated as successful current AI',async()=>{
 values.clear();calls=0;fail=false;values.set('sitrep-INDOPACOM',cached('SOURCE_ONLY',1));
 const r=await service.generateCocom('PACOM');assert.equal(calls,1);assert.equal(r.report.mode,'AI');assert.equal(r.report.sourceItemCount,1);assert.equal(r.report.sources[0].title,'Taiwan announces air defense exercise');
});
test('four-hour schedule refreshes before six-hour freshness threshold',async()=>{
 values.clear();calls=0;values.set('sitrep-INDOPACOM',cached('AI',4));
 await service.generateCocom('PACOM');assert.equal(calls,1);
});
test('failed generation preserves dated compatible AI without overwriting',async()=>{
 values.clear();calls=0;fail=true;const old=cached('AI',8);values.set('sitrep-INDOPACOM',old);
 const r=await service.generateCocom('PACOM');assert.equal(r.reason,'generation-failed-preserved');assert.equal(values.get('sitrep-INDOPACOM'),old);assert.equal(r.report.ts,old.ts);
});
test('expired and legacy unfiltered caches do not survive failed generation',async()=>{
 for(const old of [cached('AI',25),{...cached('AI',1),policyVersion:'old'}]){
  values.clear();fail=true;values.set('sitrep-INDOPACOM',old);
  const r=await service.generateCocom('PACOM');assert.equal(r.report.mode,'SOURCE_ONLY');assert.doesNotMatch(r.report.text,/Bolivia/);
 }
});
test('malformed timestamps are missing rather than current',()=>assert.equal(service.ageState('bad').state,'MISSING'));
