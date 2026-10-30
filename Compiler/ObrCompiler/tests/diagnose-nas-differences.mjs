import fs from 'node:fs';import path from 'node:path';import {classifyNas} from './NasRequestClassification.mjs';
if(!process.argv[2])throw Error('Usage: node diagnose-nas-differences.mjs report.json [classification.json]');
const file=path.resolve(process.argv[2]),report=JSON.parse(fs.readFileSync(file)),artifact=path.dirname(report.input),rows=[];
for(const failure of report.failures.filter(f=>f.message==='raw post-prompt NAS request sequence equals baseline')){
 const variant=failure.scope.split(' ').at(-1),baseline=classifyNas(failure.details.baseline,'baseline',artifact),candidate=classifyNas(failure.details.candidate,variant,artifact);
 const same=JSON.stringify(baseline.normalized)===JSON.stringify(candidate.normalized),classified=baseline.errors.length===0&&candidate.errors.length===0&&same;
 rows.push({scope:failure.scope,classifiedOnlyAsExecutableLoading:classified,rawDifferenceRetained:true,applicationRequestsEqualAfterExplicitDiagnosticAbstraction:same,baseline,candidate});
}
const result={input:file,inputRaw:report.input,created:new Date().toISOString(),rawDifferences:rows.length,classifiedExecutableOnly:rows.filter(r=>r.classifiedOnlyAsExecutableLoading).length,unclassified:rows.filter(r=>!r.classifiedOnlyAsExecutableLoading),rows,note:'Diagnostic classification does not erase strict raw NAS request mismatches or assert owner approval of a requirement exception.'};
const output=path.resolve(process.argv[3]??path.join(path.dirname(file),'nas-difference-classification.json'));fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({rawDifferences:result.rawDifferences,classifiedExecutableOnly:result.classifiedExecutableOnly,unclassified:result.unclassified.map(r=>r.scope),output},null,2));
