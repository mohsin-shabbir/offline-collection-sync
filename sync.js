/** Framework-independent mobile collection protocol. Money uses integer minor units. */
export function validate(p) {
  for (const key of ['id', 'agreementId', 'currency']) {
    if (typeof p?.[key] !== 'string' || !p[key].trim()) throw new Error(`${key} is required`);
  }
  if (!/^[A-Z]{3}$/.test(p.currency)) throw new Error('Invalid currency');
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) throw new Error('Invalid amount');
}
export class ConflictError extends Error {}
export class PermanentError extends Error {}
const canonical = p => ({id:p.id,agreementId:p.agreementId,currency:p.currency,amountMinor:p.amountMinor});

/** Simulated server. Production requires a transaction and unique database constraint. */
export class Ledger {
  #records = new Map();
  accept(payment) {
    validate(payment);
    const record = canonical(payment), previous = this.#records.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new ConflictError('Key reused with different payload');
    if (!previous) this.#records.set(record.id, Object.freeze(record));
    return {id:record.id,status:'accepted',duplicate:Boolean(previous)};
  }
  get size() { return this.#records.size; }
}

/** In-memory device outbox; storage, clock and transport are explicit boundaries. */
export class Outbox {
  #items = new Map();
  #busy = false;
  constructor({maxAttempts=4,baseDelayMs=1000}={}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts<1 || maxAttempts>20) throw new Error('Invalid attempt limit');
    if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs<1 || baseDelayMs>60000) throw new Error('Invalid delay');
    this.maxAttempts=maxAttempts;this.baseDelayMs=baseDelayMs;
  }
  enqueue(payment) {
    validate(payment);
    if(this.#items.has(payment.id)) throw new ConflictError('Payment already queued');
    this.#items.set(payment.id,{payment:Object.freeze(canonical(payment)),status:'pending',attempts:0,nextAttemptAt:0,error:null});
  }
  snapshot() { return [...this.#items.values()].map(x=>({...x,payment:{...x.payment}})); }
  async sync(send,now=Date.now()) {
    if(!Number.isSafeInteger(now)||now<0) throw new Error('Invalid clock');
    if(this.#busy) throw new Error('Synchronization already running');
    this.#busy=true;
    try {
      for(const item of this.#items.values()) {
        if(item.status!=='pending'||item.nextAttemptAt>now) continue;
        item.attempts++;
        try {
          const receipt=await send({...item.payment});
          if(receipt?.id!==item.payment.id||receipt.status!=='accepted') throw new Error('Invalid receipt');
          item.status='synced';item.error=null;
        } catch(error) {
          item.error=error instanceof Error?error.message:'Transport failure';
          if(error instanceof ConflictError||error instanceof PermanentError||item.attempts>=this.maxAttempts) item.status='review';
          else item.nextAttemptAt=now+Math.min(60000,this.baseDelayMs*2**(item.attempts-1));
        }
      }
      return this.snapshot();
    } finally { this.#busy=false; }
  }
}
