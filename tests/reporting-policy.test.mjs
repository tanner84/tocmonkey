import test from 'node:test';
import assert from 'node:assert/strict';
import { filterReporting, relevant, significant, validArticle } from '../enhancements/reporting-policy.mjs';
const now=Date.parse('2026-09-07T21:00:00Z');
const item=(title,extra={})=>({title,url:'https://example.org/story',pubDate:'2026-09-07T20:00:00Z',...extra});
test('publisher tags cannot put Gaza, Bolivia or Germany in PACOM',()=>{
 for(const title of ['Israeli clearance of Gaza rubble could destroy evidence','Bolivia confirms deaths after military base explosion','Russia orders German consulate to close']) {
  assert.equal(filterReporting([item(title,{cocom:'INDOPACOM',source:'Straits Times'})],'PACOM',{now}).length,0);
 }
 assert.equal(relevant(item('Egypt military exercise announced'),'CENTCOM'),true);
});
test('sports and entertainment stay out of SIGACTS while actual attacks remain',()=>{
 for(const title of ['S. Korean Park Ji-hyun joins new international basketball league','Springboks make changes for final New Zealand rugby test','Russian cinema owners end unlicensed screenings','Champagne production halves in France']) {
  assert.equal(significant(item(title)),false,title);
 }
 assert.equal(significant(item('Bombing at football stadium in Iraq kills spectators')),true);
 assert.equal(filterReporting([item('Sweden signs HIMARS deal with Finland')],'EUCOM',{purpose:'sigacts',now}).length,1);
});
test('article geography uses whole words and headline priority',()=>{
 assert.equal(relevant(item('Bolivia confirms military base explosion'),'PACOM'),false); // no PLA substring
 assert.equal(relevant(item('Taiwan security plan announced'),'PACOM'),true);
 assert.equal(relevant(item('Kosovo security crisis deepens',{desc:'Officials compare response with Gaza.'}),'CENTCOM'),false);
 assert.equal(relevant(item('China and Iran sign defense agreement'),'PACOM'),true);
 assert.equal(relevant(item('China and Iran sign defense agreement'),'CENTCOM'),true);
});
test('reject undated, future, stale, generic or unsafe source records',()=>{
 for(const bad of [item('DW'),item('An otherwise valid title',{pubDate:''}),item('Taiwan defense news',{pubDate:'2026-09-08T21:00:00Z'}),item('Taiwan defense news',{pubDate:'2026-01-01T00:00:00Z'}),item('Taiwan defense news',{url:'javascript:alert(1)'})]) assert.equal(validArticle(bad,{now}),false);
});
test('dedupe full titles and keep broader dated regional news in OSINT',()=>{
 const sports=item('South Korea basketball league welcomes player');
 assert.equal(filterReporting([sports,sports],'PACOM',{now}).length,1);
 assert.equal(filterReporting([sports],'PACOM',{purpose:'sigacts',now}).length,0);
});
