import json, tempfile
from pathlib import Path
from gepa import optimize
from gepa.core.adapter import EvaluationBatch
from gepa.proposer.base import CandidateProposal
from gepa.strategies.acceptance import StrictImprovementAcceptance

class Adapter:
    propose_new_texts = None
    def __init__(self):
        self.calls = 0
        self.restored = False
    def evaluate(self, batch, candidate, capture_traces=False):
        self.calls += len(batch)
        outputs = [{"id": x["id"], "evidenceRef": "fixture://"+x["id"], "context": x["context"], "correct": candidate["policy"] == "contextual"} for x in batch]
        return EvaluationBatch(outputs=outputs, scores=[1.0 if x["correct"] else 0.0 for x in outputs], trajectories=outputs if capture_traces else None, objective_scores=[{"quality":1.0 if x["correct"] else 0.0} for x in outputs])
    def make_reflective_dataset(self, candidate, eval_batch, components_to_update):
        return {k:[{"Feedback":"Use relevant context", "evidenceRef":x["evidenceRef"], "Context":x["context"]} for x in eval_batch.trajectories] for k in components_to_update}
    def get_adapter_state(self):
        return {"calls":self.calls}
    def set_adapter_state(self, state):
        if state:
            self.calls=state["calls"]
            self.restored=True

datasets_seen=[]
def proposer(candidate, reflective_dataset, components_to_update, **kwargs):
    assert all("evidenceRef" in row and "Context" in row for rows in reflective_dataset.values() for row in rows)
    datasets_seen.append(reflective_dataset)
    return {"policy":"contextual"}

train=[{"id":"train-a","context":"undocumented API"},{"id":"train-b","context":"known API"}]
val=[{"id":"val-a","context":"undocumented API"},{"id":"val-b","context":"known API"}]
run_dir=tempfile.mkdtemp(prefix="bb083-gepa-")
a=Adapter()
args=dict(seed_candidate={"policy":"baseline"},trainset=train,valset=val,custom_candidate_proposer=proposer,reflection_minibatch_size=2,max_metric_calls=8,run_dir=run_dir,seed=17,cache_evaluation=True,write_agent_state=True)
r=optimize(adapter=a,**args)
assert r.best_candidate == {"policy":"contextual"}
assert len(r.candidates)==2
assert datasets_seen
assert all(not row["evidenceRef"].startswith("fixture://val-") for ds in datasets_seen for rows in ds.values() for row in rows)
b=Adapter()
resumed=optimize(adapter=b,**args)
assert b.restored and resumed.best_candidate==r.best_candidate
proposal=CandidateProposal(candidate={"policy":"tradeoff"},parent_program_ids=[0],subsample_scores_before=[1.0,0.0],subsample_scores_after=[0.4,0.9])
tradeoff_accepted=StrictImprovementAcceptance().should_accept(proposal,None)
assert tradeoff_accepted is True
result={"evidenceClass":"DETERMINISTIC_UPSTREAM_SEAM_PROBE","upstreamCommit":"d771eb21b5dd3228bc3f567293d2ccfc423fc900","upstreamSourceFiles":111,"modelCalls":0,"candidateCount":len(r.candidates),"bestCandidate":r.best_candidate,"totalMetricCalls":r.total_metric_calls,"adapterCalls":a.calls,"resumeRestoredAdapter":b.restored,"adapterCallsAfterResume":b.calls,"trainValidationReflectionIsolation":True,"evidenceAndContextSurviveAdapter":True,"sumImprovementCanHidePerCaseRegression":tradeoff_accepted,"productionEvidence":False,"limitations":["Synthetic deterministic proposer and scoring; no LLM effectiveness measurement","Same-process fresh adapter resume, not crash-injected cross-process recovery","No ExHarness benchmark service or independent Jev invoked","Optimizer acceptance is not product promotion" ]}
c=Adapter()
budget_args={**args,"max_metric_calls":7,"run_dir":tempfile.mkdtemp(prefix="bb083-budget-")}
budget_run=optimize(adapter=c,**budget_args)
result["budgetProbe"]={"configuredMaxMetricCalls":7,"actualMetricCalls":budget_run.total_metric_calls,"adapterCalls":c.calls}
Path(__file__).with_name('gepa-probe-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
