"""Private subprocess boundary for exact math on untrusted questions."""
import json,sys,re
import mathcheck
from sympy import Rational

value=json.load(sys.stdin)
question=value['question']
if not isinstance(question,str) or len(question)>3000:raise ValueError('Invalid question')
if value.get('op')=='analyze':
    concept=mathcheck.row_scaling_explanation(question) or mathcheck.improper_log_integral_explanation(question)
    checks=concept['checks'] if concept else mathcheck.analyze(question)
    print(json.dumps({'checks':checks,'instant':concept['text'] if concept else mathcheck.instant_answer(question,checks),
                      'prompt':mathcheck.prompt_block(checks) if checks else '',
                      'unsupported_domain':mathcheck.unsupported_domain(question)},default=str))
elif value.get('op')=='finalize':
    checks=value['checks']
    for check in checks:check['keys']=[Rational(k) for k in check['keys']]
    print(json.dumps({'text':mathcheck.finalize(question,value['text'],checks)}))
elif value.get('op')=='practice-comparison':
    attempt=value.get('attempt','')
    if not isinstance(attempt,str) or len(attempt)>1000:raise ValueError('Invalid attempt')
    system=mathcheck.find_system(question);checks=mathcheck.analyze(question);lines=[]
    # Compare explicitly supplied final variable values only. Arbitrary prose,
    # intermediate work, and unsupported number systems are not graded.
    if system and mathcheck.modulus_of(question) is None and len(checks)==1 and checks[0]['kind']=='system' and len(checks[0]['keys'])==len(system[0]):
        for name,expected in zip(system[0],checks[0]['keys']):
            if len(re.findall(r'(?<![\w])'+re.escape(name)+r'\s*=',attempt))!=1:continue
            values=re.findall(r'(?<![\w])'+re.escape(name)+r'\s*=\s*('+mathcheck.NUMBER+r')(?![\w./])(?=\s*(?:[,;.$)\n]|$))',attempt)
            if len(values)!=1:continue
            actual=mathcheck._entry(values[0])
            if actual is None:continue
            if actual==expected:lines.append('Your $%s = %s$ matches the checked final value.'%(name,mathcheck._tex(actual)))
            else:lines.append('Your $%s = %s$ differs from the checked final value $%s = %s$.'%(name,mathcheck._tex(actual),name,mathcheck._tex(expected)))
    checked=[mathcheck._result('check',line,[]) for line in lines]
    lines.append('Compare each of your steps with the row operations above. Your written reasoning is not automatically graded.' if lines else 'Compare your result and each step with the checked answer above. I could not identify a single final value for each variable in your attempt; your written reasoning is not automatically graded.')
    print(json.dumps({'text':'\n\n'.join(lines),'checks':checked},default=str))
elif value.get('op')=='study-eigenvector':
    if not re.search(r'\beigenvectors?\b',question,re.I) or mathcheck.modulus_of(question) is not None:
        raise ValueError('This clarification covers real eigenvectors only')
    a=mathcheck.Matrix([[0,0],[0,1]]);v=mathcheck.Matrix([1,0]);image=a*v
    assert v!=mathcheck.Matrix.zeros(2,1) and image==0*v
    summary='For the AI-written illustration $A = %s$ and $v = %s$, the nonzero input vector satisfies $A v = %s = 0v$. Thus $v$ is an eigenvector with eigenvalue $0$.'%(mathcheck._tex(a),mathcheck._tex(v),mathcheck._tex(image))
    check=mathcheck._result('check',summary,[])
    text=('AI-written study material. General mathematical explanation over the real numbers:\n\n'
          'An eigenvector $v$ must be nonzero and satisfy $A v = \\lambda v$. The eigenvalue $\\lambda$ may be zero: then the nonzero input vector is mapped to the zero vector. This does not make the input vector zero. A negative eigenvalue reverses its orientation along the same line.\n\n'
          '### Checked illustration\n'+summary+'\n\n'
          '### Compare with your attempt\n'
          'Check your description of scaling against $A v = \\lambda v$. Keep the condition $v \\ne 0$ explicit. Distinguish the input $v$ from its image $A v$: only the input must be nonzero. Compare your wording with these conditions; your written reasoning has not been automatically graded.')
    print(json.dumps({'text':text,'checks':[check]},default=str))
else:raise ValueError('Invalid operation')
