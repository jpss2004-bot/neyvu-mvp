"""Bounded teaching explanations from version-pinned original definitions.

This is a small curriculum adapter, not a general semantic verifier. It handles
two documented conceptual confusions only when all original anchors are present.
Missing/contradictory definitions never receive a made-up expansion or citation.
"""
import hashlib
import re
import unicodedata
import injectionguard


def normalized(text):
    text=unicodedata.normalize('NFKC',text)
    return re.sub(r'\s+',' ',re.sub(r'(\w)-\s+(\w)',r'\1\2',text)).strip().lower()


def evidence(job,kind):
    selected=set(job.get('context') or [])
    for n,source in enumerate(job.get('sources') or [],1):
        if selected and source.get('id') not in selected:continue
        packet=source.get('teaching_evidence') or {}
        if source.get('kind')!='file' or injectionguard.untrusted(source):continue
        if packet.get('format')!='source-teaching-evidence/1' or packet.get('kind')!=kind:continue
        if packet.get('source_id')!=source.get('id') or packet.get('version_id')!=source.get('version_id'):continue
        material=source.get('source_material') or {}
        if material.get('kind')!='observed_source' or packet.get('text_sha256')!=material.get('text_sha256'):continue
        anchors=packet.get('anchors')
        if not isinstance(anchors,list) or len(anchors)!=(1 if kind in ('note-goals','test-guide','novel-contentment') else 4):continue
        valid=True
        for a in anchors:
            if not isinstance(a,dict):valid=False;break
            quote=a.get('quote');start=a.get('start');end=a.get('end')
            if not isinstance(quote,str) or not 30<=len(quote)<=(10000 if kind=='test-guide' else 3000 if kind=='note-goals' else 1800) or type(start)!=int or type(end)!=int or start<0 or end-start!=len(quote) or hashlib.sha256(quote.encode()).hexdigest()!=a.get('sha256'):valid=False;break
        if valid:yield n,source,[normalized(a['quote']) for a in anchors]


def fssd(job):
    q=job.get('question') or ''
    if not re.search(r'\b(?:FSSD|ABCD)\b',q,re.I):return None
    if re.search(r'\b(?:eight|8)\s*(?:SPs?|principles)|list all.*principles',q,re.I):return None
    for n,source,a in evidence(job,'fssd-steps'):
        required=[('a. in this step','vision of success','sustainability principles'),('b. in this step','current','assets'),('c. in this step','brainstorming','possible solutions'),('d. in this step','prioritize','strategic plan','flexible platforms','return on investment')]
        if not all(all(term in text for term in terms) for text,terms in zip(a,required)):continue
        text=("FSSD uses a sustainability-framed vision to judge the steps that could take you there. In ABCD, A establishes that vision; B compares the current situation with it; C generates possible actions; and D prioritizes those actions into a strategic plan. D weighs progress toward the vision, flexibility for later steps and return on investment together. [%d]"%n)
        if re.search(r'\b(?:construction|building|passive house|energy savings)\b',q,re.I):
            text+=("\n\nApplied to your construction-versus-energy tradeoff, I would start with a comparison you can defend. Define what success means beyond lower heating demand, then compare the proposed house with a realistic alternative. Record the extra impacts of materials and construction alongside operating-energy use over the same assumed lifetime. At C, consider alternatives such as a different insulation material or specification; at D, explain which option moves toward the vision while keeping later improvements feasible. These are suggested applications, not reported facts about this project."
              "\n\nBefore claiming that future savings outweigh construction impacts, you need a baseline design, material quantities and impact estimates, expected energy use for both designs, the energy source, and a stated time horizon. Include maintenance or replacement assumptions where they could change the comparison. Keep a financial payback claim separate from an environmental comparison. Unknown values should stay unknown."
              "\n\nYour next question: **Compared with which realistic baseline, and over what lifetime, could the additional construction impacts be outweighed by lower operating impacts?** Start by identifying that baseline and listing which figures the case actually provides.")
        else:
            text+="\n\nTo use it, name your desired outcome and one gap in the current situation before choosing a solution. Then list alternatives and justify a first action using all three D considerations. What specific gap are you trying to close?"
        return text
    return None


def extended_belief(job):
    q=job.get('question') or ''
    if not re.search(r'\b(?:Otto|Inga|extended mind|phone|notebook)\b',q,re.I):return None
    for n,source,a in evidence(job,'extended-belief'):
        if not ('same role' in a[0] and 'memory' in a[0] and 'directly available without difficulty' in a[1] and 'automatically endorses' in a[1] and 'arguable' in a[2] and 'does not threaten our claim' in a[3]):continue
        boundary=bool(re.search(r'\b(?:any|every|counterexample|what fails|does.*count)\b',q,re.I))
        if boundary:
            return ("A phone or notebook does not qualify just because someone owns or occasionally uses it. Clark and Chalmers emphasize a stable role in the person's life, information that is readily available when relevant, and acceptance of the retrieved information as a matter of course. They treat prior conscious endorsement as a more debatable additional criterion. [%d]"%n
              +"\n\nIllustrative counterexample (AI-written): A student opens an unfamiliar website on a borrowed phone to look up a museum address for the first time. The student has no established reliance on that resource and treats the result as an untrusted claim to investigate. The phone is helping with a task, but this case lacks the standing reliance and automatic endorsement that support Otto's case."
              +"\n\nAutomatic endorsement means ordinarily accepting the retrieved information without checking its truth afresh. It does not mean that reaching for or reading the tool must be unconscious. Occasional temporary disconnection is compatible with the authors' argument; a phone being in a pocket would not by itself establish a failure of access. [%d]"%n
              +"\n\nFor your next example, identify the particular information and explain whether the person normally relies on and accepts it when acting. Naming the device alone does not settle the case.")
        return ("Clark and Chalmers argue that Otto's notebook can play the same role in guiding his actions as biological memory plays for Inga. Inga recalls the museum's location; Otto consults his regularly used notebook. On their account, the relevant belief can be there before either person retrieves it. The argument asks what role the information plays, rather than deciding its status from its location inside or outside the head. [%d]"%n
          +"\n\nThe notebook matters because it is a stable part of Otto's life, its information is readily available, and he normally accepts what he retrieves from it. That last condition is automatic endorsement: accepting the information as a matter of course, without checking its truth afresh. It does not require unconscious reading or effortless movement. Prior conscious endorsement is a further condition the authors themselves call debatable. [%d]"%n
          +"\n\nTheir claim also allows occasional temporary disconnection. The relevant test is reliable availability when the information is needed, not uninterrupted access at every moment. These conditions explain why occasional help from a tool is not enough on its own to establish a standing belief. [%d]"%n
          +"\n\nTo test your understanding, explain why Otto could still have the belief while his notebook is closed, then contrast that with consulting an unfamiliar resource for the first time.")
    return None


def mill_concern(job):
    q=job.get('question') or ''
    if not (re.search(r'\bMill\b',q,re.I) and re.search(r'social rights',q,re.I) and re.search(r'care|others|doctrine',q,re.I)):return None
    for n,source,a in evidence(job,'mill-concern'):
        if not ('each claimant' in a[0] and 'no violation of liberty' in a[0] and 'disinterested' in a[1] and 'persuade' in a[1] and 'encouragement' in a[2] and 'distinct and assignable obligation' in a[3]):continue
        return ("Mill objects to an unlimited doctrine of social rights: if everyone has an enforceable claim that everyone else behave exactly as they think right, almost any disliked conduct or opinion can become a grievance. Each claimant gets to define the required moral, intellectual and physical perfection. That leaves no protected sphere of individual liberty. His criticism targets that unlimited claim, not every genuine obligation to others. [%d]"%n
          +"\n\nConcern for others has a different scope. Mill calls for more disinterested effort to promote their good, and says people owe one another help and encouragement. For mature adults' self-regarding choices, he favors reasons and persuasion over coercion. You can care about a choice that seems bad for a friend without first proving measurable harm to someone else. Harm and distinct obligations matter when justifying interference; they are not conditions for all concern or advice. [%d]"%n
          +"\n\nIllustrative example (AI-written): A friend spends their free time on a hobby you think is wasting their abilities. You might ask about their goals, explain your concern and offer help. Your disagreement alone would not give you a right to force them to stop. If a separate duty to someone else is being breached, that needs its own argument; it cannot simply be assumed from your disapproval."
          +"\n\nMy interpretation: rejecting the unlimited doctrine protects room for adults to judge their own lives while preserving concern, discussion and real duties. In your next practice answer, separate two questions: why might someone offer advice, and what additional justification would be needed to coerce the person?")
    return None


def test_guide(job):
    q=job.get('question') or ''
    if not (re.search(r'\btest\s*\d+\b',q,re.I) and re.search(r'get ready|prepare|what.{0,30}(?:study|look like)',q,re.I)):return None
    for n,s,a in evidence(job,'test-guide'):
        body=s['teaching_evidence']['anchors'][0]['quote']
        paragraphs=body.split('\n\n')
        structure=next((p for p in paragraphs if p.startswith('Structure of the Test ')),None)
        themes=[p for p in paragraphs if p.startswith(('Chapter Four:','Themes from '))]
        if not structure or not themes:continue
        # Quoted guide questions identify what to study; they are not answers.
        # Keep every condition, approximate count and chapter qualifier intact.
        text='Prepare the assigned readings and lectures named in the guide. Here is its exact description of the scope, format and arrangements: [%d]\n\n> '%n+structure.replace('\n','\n> ')+' [%d]'%n
        text+='\n\nThe review is a study aid, explicitly not exhaustive. It supplements the assigned readings and lectures; it does not replace them. [%d]'%n
        text+='\n\nUse these original prompts to identify what you need to explain. They are questions from the guide, not a model answer key: [%d]'%n
        for block in themes:
            block=re.sub(r'\s+\d{1,2}/\d{1,2}/\d{4}\s+\d+\s*$','',block)
            text+='\n\n'+'\n'.join('> '+line for line in re.split(r'(?<=\?)\s+',block))+' [%d]'%n
        text+='\n\nStart with one prompt: write a short answer with the notes closed, then check its conclusion, supporting reason and qualifications against the assigned text. Revise the first point you cannot justify. Move to another theme only after that check; this does not certify mastery or a fresh Moodle check.'
        return text
    return None


def novel_contentment(job):
    q=job.get('question') or ''
    if not (re.search(r'Glass Harbor|Harbor Council',q,re.I) and re.search(r'content|happ(?:y|iness)',q,re.I)):return None
    for n,s,a in evidence(job,'novel-contentment'):
        if 'teaching people to love the place assigned to them' not in a[0]:continue
        return ("In the saved novel passage, every lesson aims to make people love their assigned place. That gives you a concrete basis for questioning what their contentment establishes. [%d]"%n
          +"\n\nMy interpretation: satisfaction alone cannot settle whether the Harbor Council is good if the system also shapes the preferences through which it is judged. You would also want to ask what alternatives people have and whether they can examine or revise their lives. This does not mean every character is incapable of criticism, or that feeling happy counts for nothing."
          +"\n\nPossible class contribution, offered as interpretation: “I would distinguish feeling content from having the freedom to assess your life. If institutions condition people to like a fixed place, their satisfaction alone cannot establish that those institutions are justified. I would want to ask what choices and opportunities for critical reflection remain.”"
          +"\n\nDiscussion question: **How should we judge a social system when it helps produce the desires by which people approve of it?**"
          +"\n\nNext, choose one conditioning passage and explain which preference it shapes. Then ask whether that person has a meaningful chance to question or change the role. This uses the supplied passage; it is not a claim to have reread the whole novel.")
    return None


def answer(job):
    return fssd(job) or extended_belief(job) or mill_concern(job) or test_guide(job) or novel_contentment(job)
