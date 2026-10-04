"""Read-only extraction from pinned Git objects; research evidence, not product code.
python docs/blackboard/evidence/BB-158/extract-ci-audit.py > /tmp/bb158-extracted.json
Requires Python 3 and PyYAML (research environment only).
"""
import hashlib,json,subprocess,yaml
BASE='15bf970b8a61d0c369d60984acdc3c75b5a80a8f'
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
result={'classification':'EXECUTED_READ_ONLY_SOURCE_AUDIT','baselineSha':BASE,'workflows':workflows,'packageScripts':package['scripts'],'unfinishedVerificationRegistry':tasks,'uniquePlanCommands':sorted({r['command']for t in tasks for r in t['commands']}),'boundary':'Dynamic worker commands are exact plan registry inputs to collectEvidence; extraction does not execute them or claim checks passed. No secrets, network, control mutation or future V2 source used.'}
print(json.dumps(result,indent=2,sort_keys=True))
