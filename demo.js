import {Ledger,Outbox} from './sync.js';
const device=new Outbox(),server=new Ledger();
device.enqueue({id:'demo-001',agreementId:'AG-DEMO-01',amountMinor:125050,currency:'PKR'});
await device.sync(p=>{server.accept(p);throw new Error('Connection lost after acceptance');},0);
console.log('After lost response:',device.snapshot()[0].status);
await device.sync(p=>server.accept(p),1000);
console.log('After retry:',device.snapshot()[0].status);
console.log('Recorded payments:',server.size);
