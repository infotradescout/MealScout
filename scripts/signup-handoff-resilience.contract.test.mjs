import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
const base='161a161a4dd876630fee487ec0cd88f6aa418e5f';
const original=file=>execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'});

test('all three registration success handlers differ only by guarded optional draft cleanup',()=>{
  const file='client/src/pages/customer-signup.tsx',before=original(file),after=readFileSync(file,'utf8');
  const oldBlock='      if (typeof window !== "undefined") {\n        window.localStorage.removeItem(SIGNUP_DRAFT_KEY);\n      }';
  const newBlock='      try {\n        if (typeof window !== "undefined") {\n          window.localStorage.removeItem(SIGNUP_DRAFT_KEY);\n        }\n      } catch {\n        // Optional draft cleanup must not interrupt a successful registration.\n      }';
  assert.equal(before.split(oldBlock).length-1,3);
  assert.equal(after.trimEnd(),before.replaceAll(oldBlock,newBlock).trimEnd());
});

test('host details, validation and save payload are unchanged; pending auth cannot grant access',()=>{
  const file='client/src/pages/host-signup.tsx',before=original(file),after=readFileSync(file,'utf8');
  const marker='  return (\n    <div className="min-h-screen bg-[var(--bg-layered)] relative overflow-hidden">';
  assert(before.includes(marker)&&after.includes(marker));
  assert.equal(after.slice(after.indexOf(marker)).trimEnd(),before.slice(before.indexOf(marker)).trimEnd());
  const start=before.indexOf('  const validate =');
  const end=before.indexOf('\n  if (isLoading) {',start);
  assert(start>=0 && end>start,'Compare the complete original validation and submit block');
  const oldLogic=before.slice(start,end).trimEnd();
  const newLogic=after.slice(after.indexOf('  const validate ='),after.indexOf('  if (authState === "loading" && authError)')).replace('    if (!isAuthenticated || authState !== "authenticated") return;\n','').trimEnd();
  assert.equal(newLogic,oldLogic);
  assert.match(after,/if \(authState === "loading"\) return;/);
  assert.match(after,/if \(authState === "guest"\)/);
  assert.match(after,/if \(!isAuthenticated \|\| draftLoaded.current\) return;/);
  assert.match(after,/if \(isLoading \|\| !isAuthenticated\) return;/);
  assert.match(after,/await refetch\(\)/);
});

test('server auth, verification, storage ownership and the shared authentication hook are untouched',()=>{
  const files=['client/src/hooks/useAuth.ts','client/src/lib/queryClient.ts','shared/businessSignupIntent.ts','server/routes/locationDemandRoutes.ts'];
  for(const file of files)assert.equal(readFileSync(file,'utf8'),original(file),file);
  assert.equal(execFileSync('git',['diff','--name-only',base,'HEAD','--','server','shared'],{encoding:'utf8'}).trim(),'');
});

test('share URL generation, eligibility, canonical routing and provider calls remain byte-identical',()=>{
  const file='client/src/lib/share.ts',before=original(file),after=readFileSync(file,'utf8');
  const start='export function setAffiliateRef(',end='\nfunction normalizeSharePath(';
  assert.equal(after.slice(0,after.indexOf(start)),before.slice(0,before.indexOf(start)));
  assert.equal(after.slice(after.indexOf(end)).trimEnd(),before.slice(before.indexOf(end)).trimEnd());
  assert.equal(after.slice(after.indexOf(start),after.indexOf(end)).trimEnd(),`export function setAffiliateRef(ref: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (ref) {
      window.localStorage.setItem(AFFILIATE_REF_STORAGE_KEY, ref);
    } else {
      window.localStorage.removeItem(AFFILIATE_REF_STORAGE_KEY);
    }
  } catch {
    // Referral persistence is optional; it must not block signup or authentication.
  }
}

export function getStoredAffiliateRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(AFFILIATE_REF_STORAGE_KEY);
  } catch {
    return null;
  }
}`);
});

test('optional referral storage cannot throw into signup or authentication',()=>{
  const source=readFileSync('client/src/lib/share.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const load=window=>{
    const module={exports:{}};
    runInNewContext(compiled,{module,exports:module.exports,window,URL,require:name=>{
      if(name==='@/lib/queryClient')return {apiRequest:()=>{throw new Error('No provider request in storage test');}};
      if(name==='@shared/cleanAffiliateLinks')return {isLikelyCleanAffiliateTagSegment:()=>false};
      throw new Error('Unexpected module dependency');
    }});
    return module.exports;
  };
  const memory=new Map();
  const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const normal=load({localStorage:storage});
  normal.setAffiliateRef('fixture-tag');assert.equal(normal.getStoredAffiliateRef(),'fixture-tag');
  normal.setAffiliateRef(null);assert.equal(normal.getStoredAffiliateRef(),null);
  const denied={};Object.defineProperty(denied,'localStorage',{get(){throw new Error('Storage denied');}});
  const unavailable=load(denied);
  assert.doesNotThrow(()=>unavailable.setAffiliateRef('fixture-tag'));
  assert.doesNotThrow(()=>unavailable.setAffiliateRef(null));assert.equal(unavailable.getStoredAffiliateRef(),null);
  for(const method of ['getItem','setItem','removeItem']){
    const api=load({localStorage:{...storage,[method]:()=>{throw new Error('Storage denied');}}});
    assert.doesNotThrow(()=>api.setAffiliateRef('fixture-tag'));
    assert.doesNotThrow(()=>api.setAffiliateRef(null));
    if(method==='getItem')assert.equal(api.getStoredAffiliateRef(),null);
  }
  const server=load(undefined);assert.doesNotThrow(()=>server.setAffiliateRef('fixture-tag'));assert.equal(server.getStoredAffiliateRef(),null);
});
