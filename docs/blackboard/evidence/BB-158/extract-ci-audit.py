"""Read-only extraction from pinned Git objects; research evidence, not product code.
python docs/blackboard/evidence/BB-158/extract-ci-audit.py > /tmp/bb158-extracted.json
Requires Python 3 and PyYAML (research environment only).
"""
import hashlib,json,subprocess,yaml,re,posixpath
BASE='3fbdac000ea6d51f431001c03934ec6e777214f3'
def git(*args):return subprocess.check_output(['git',*args],text=True)
def body(ref):return git('show',BASE+':'+ref)
def digest(text):return hashlib.sha256(text.encode()).hexdigest()
paths=git('ls-tree','-r','--name-only',BASE,'--','.github/workflows').splitlines()
workflows=[]
for ref in paths:
 text=body(ref);doc=yaml.load(text,Loader=yaml.BaseLoader);jobs=[]
 for name,job in doc['jobs'].items():
  steps=[{'name':s.get('name')or s.get('id')or s.get('uses'),'uses':s.get('uses'),'run':s.get('run'),'if':s.get('if'),'envKeys':sorted(s.get('env',{})),'with':s.get('with')}for s in job.get('steps',[])]
  jobs.append({'id':name,'needs':job.get('needs',[]),'if':job.get('if'),'uses':job.get('uses'),'with':job.get('with'),'steps':steps})
 workflows.append({'ref':ref,'sha256':digest(text),'triggers':doc.get('on'),'concurrency':doc.get('concurrency'),'permissions':doc.get('permissions'),'jobs':jobs})
package=json.loads(body('package.json'));graph=json.loads(body('docs/blackboard/work-graph.json'))
tasks=[]
for task in graph['tasks']:
 if task['status']=='DONE'or task['title'].startswith('[WITHDRAWN'):continue
 ref=task.get('contract',{}).get('planRef')
 if not ref:raise ValueError('unfinished task without declared plan '+task['id'])
 text=body(ref);plan=json.loads(text)
 tasks.append({'id':task['id'],'lane':task['lane'],'phase':task['phase'],'planRef':ref,'planFileSha256':digest(text),'commands':[{'id':r['id'],'command':r['command']}for r in plan['verificationPlan']]})
# Census all shipped verifier entrypoints, including indirect Backend verification.
# It is a source inventory, not a sound evaluator of arbitrary shell commands.
tracked=git('ls-tree','-r','--name-only',BASE).splitlines()
runtime=[r for r in tracked if r.endswith(('.js','.mjs')) and (r.startswith('scripts/') or (r.startswith('packages/') and ('/src/' in r or '/bin/' in r)))]
symbols=['createLocalCommandVerifier','normalizeVerificationRecord','assessClaimVerification','collectEvidence','callJev','verifyDelivery']
census=[]
for ref in runtime:
 text=body(ref);hits=[{'line':i,'text':line.strip()} for i,line in enumerate(text.splitlines(),1) if any(re.search(r'\b'+symbol+r'\b',line)for symbol in symbols)]
 if hits:census.append({'ref':ref,'sha256':digest(text),'hits':hits})
# Resolve every literal relative JS import/export/dynamic import from census roots.
# Nonliteral imports are retained explicitly rather than silently ignored.
seen=set();pending=[r['ref']for r in census];modules=[]
while pending:
 ref=pending.pop()
 if ref in seen:continue
 seen.add(ref);text=body(ref);deps=[];unresolved=[]
 for match in re.finditer(r"(?:from\s*|import\s*\(|import\s*)['\"]([^'\"]+)['\"]",text):
  target=match.group(1)
  if not target.startswith('.'):continue
  path=posixpath.normpath(posixpath.join(posixpath.dirname(ref),target))
  if path in tracked:
   deps.append(path)
   if path.endswith(('.js','.mjs')):pending.append(path)
  else:unresolved.append(target)
 dynamic=[line.strip()for line in text.splitlines()if re.search(r'import\s*\(',line)and not re.search(r"import\s*\(\s*['\"]",line)]
 modules.append({'ref':ref,'sha256':digest(text),'relativeDependencies':sorted(set(deps)),'unresolvedRelative':sorted(set(unresolved)),'nonliteralImportLines':dynamic})
scriptEdges={name:sorted(set(re.findall(r'npm run ([A-Za-z0-9:_-]+)',command)+(['test']if re.search(r'\bnpm test\b',command)else[])))for name,command in package['scripts'].items()}
scriptClosure=set();pending=['verify']
while pending:
 name=pending.pop()
 if name in scriptClosure:continue
 if name not in package['scripts']:raise ValueError('unknown npm script '+name)
 scriptClosure.add(name);pending.extend(scriptEdges[name])
result={'classification':'EXECUTED_READ_ONLY_SOURCE_AUDIT','baselineSha':BASE,'workflows':workflows,'runtimeCensus':census,'literalImportClosure':sorted(modules,key=lambda r:r['ref']),'npmScriptEdges':scriptEdges,'npmVerifyScriptClosure':sorted(scriptClosure),'packageScripts':package['scripts'],'unfinishedVerificationRegistry':tasks,'uniquePlanCommands':sorted({r['command']for t in tasks for r in t['commands']}),'boundary':'Dynamic worker commands are exact plan registry inputs to collectEvidence; extraction does not execute them or claim checks passed. No secrets, network, control mutation or future V2 source used.'}
print(json.dumps(result,indent=2,sort_keys=True))
