import test from 'node:test';
import assert from 'node:assert/strict';
import {Ledger,Outbox,ConflictError,PermanentError,validate} from './sync.js';
const payment=(id='demo-001')=>({id,agreementId:'AG-DEMO-01',amountMinor:125050,currency:'PKR'});
test('replay has one business effect',()=>{
 const s=new Ledger();assert.equal(s.accept(payment()).duplicate,false);assert.equal(s.accept(payment()).duplicate,true);assert.equal(s.size,1);
});
test('rejects conflicting payload',()=>{
 const s=new Ledger();s.accept(payment());assert.throws(()=>s.accept({...payment(),amountMinor:1}),ConflictError);
});
test('validates amount, currency and identifiers',()=>{
 for(const amountMinor of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validate({...payment(),amountMinor}));
 assert.throws(()=>validate({...payment(),currency:'pkr'}));assert.throws(()=>validate({...payment(),agreementId:' '}));
});
test('lost response retries without double recording',async()=>{
 const s=new Ledger(),d=new Outbox();d.enqueue(payment());
 await d.sync(p=>{s.accept(p);throw new Error('Response lost');},0);
 assert.equal(d.snapshot()[0].status,'pending');await d.sync(p=>s.accept(p),1000);
 assert.equal(d.snapshot()[0].status,'synced');assert.equal(s.size,1);
});
test('respects exponential backoff',async()=>{
 const d=new Outbox();d.enqueue(payment());let calls=0;const send=()=>{calls++;throw new Error('Offline');};
 await d.sync(send,0);await d.sync(send,999);assert.equal(calls,1);await d.sync(send,1000);
 assert.equal(calls,2);assert.equal(d.snapshot()[0].nextAttemptAt,3000);
});
test('exhausted retries require review',async()=>{
 const d=new Outbox({maxAttempts:2});d.enqueue(payment());const send=()=>{throw new Error('Offline');};
 await d.sync(send,0);await d.sync(send,1000);assert.equal(d.snapshot()[0].status,'review');
});
test('permanent errors require review immediately',async()=>{
 const d=new Outbox();d.enqueue(payment());await d.sync(()=>{throw new PermanentError('Agreement closed');},0);assert.equal(d.snapshot()[0].status,'review');
});
test('wrong receipt never marks synchronized',async()=>{
 const d=new Outbox();d.enqueue(payment());await d.sync(()=>({id:'wrong',status:'accepted'}),0);assert.equal(d.snapshot()[0].status,'pending');
});
test('failure isolation permits later records to succeed',async()=>{
 const d=new Outbox(),s=new Ledger();d.enqueue(payment('a'));d.enqueue(payment('b'));
 const result=await d.sync(p=>{if(p.id==='a')throw new Error('Temporary');return s.accept(p);},0);
 assert.deepEqual(result.map(x=>x.status),['pending','synced']);
});
test('caller and snapshot mutations cannot change queued data',()=>{
 const d=new Outbox(),p=payment();d.enqueue(p);p.amountMinor=1;d.snapshot()[0].payment.amountMinor=2;
 assert.equal(d.snapshot()[0].payment.amountMinor,125050);assert.throws(()=>d.enqueue(payment()),ConflictError);
});
test('overlapping sync rejected and lock released',async()=>{
 const d=new Outbox();d.enqueue(payment());let release;const running=d.sync(()=>new Promise(r=>{release=r;}),0);
 await assert.rejects(d.sync(()=>{},0),/already running/);release({id:'demo-001',status:'accepted'});await running;await d.sync(()=>{},0);
});
