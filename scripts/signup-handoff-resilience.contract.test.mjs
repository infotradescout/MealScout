import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
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
