"""Exact source spans for the local model to select without rewriting quotes."""
import re

RELATIONS=('clarifies','qualifies','differs','unresolved')
RELATION_TEXT={
    'clarifies':'Proposed comparison: the saved passage clarifies the quoted class idea. This comparison has not been reviewed.',
    'qualifies':'Proposed comparison: the saved passage adds a qualification to the quoted class idea. This comparison has not been reviewed.',
    'differs':'Proposed comparison: the two passages may differ. Compare both originals before relying on either interpretation.',
    'unresolved':'The relationship remains unresolved. The saved passage does not establish the missing class wording, visual or reference.',
}

def unresolved_span(quote):
    return bool(re.search(r'not visible|cannot remember|can.t remember|not (?:yet )?identified|remains? unresolved|unclear|inaudible|shown graphically',quote,re.I))

def paired_connection(ref,speech,course):
    if not isinstance(ref,dict):raise ValueError('Invalid material comparison')
    spoken=next((a for a in speech if a['id']==ref.get('class_anchor')),None)
    saved=next((a for a in course if a['id']==ref.get('anchor')),None)
    relation=ref.get('relationship')
    if not spoken or not saved or relation not in RELATIONS:raise ValueError('Unsupported paired material anchor')
    # Missing words/visuals cannot be resolved by a candidate text passage.
    if unresolved_span(spoken['quote']) or unresolved_span(saved['quote']) or saved.get('partial_sentence') or saved.get('unverified_formula'):relation='unresolved'
    return {'material':saved['material'],'quote':saved['quote'],'class_unit':spoken['unit'],'class_quote':spoken['quote'],
            'relationship':relation,'explanation':RELATION_TEXT[relation]}

def spans(text,merge_short_tail=True):
    # Keep each sentence, including short conditions, with its exact whitespace.
    # The reader also receives the full ordered speech for antecedent/context.
    result=[];start=0
    for match in re.finditer(r'[.!?](?=\s|$)|\n',text):
        end=match.end()
        if end-start<=850:result.append(text[start:end]);start=end
    while start<len(text):
        end=min(len(text),start+850)
        if end<len(text):
            space=text.rfind(' ',start,end)
            if space>start+600:end=space
        value=text[start:end]
        if value.strip():result.append(value)
        elif result:result[-1]+=value
        start=end
    if merge_short_tail and result and len(result[-1].strip())<12 and len(result)>1:
        tail=result.pop();result[-1]+=tail
    return result

def material_spans(text):
    """Retain short answers/conditions with adjacent wording when it fits.

    A short source sentence such as No. cannot be discarded as if it were a
    page heading. Pairing it with neighboring wording also keeps its scope.
    Standalone short originals remain available instead of being dropped.
    """
    values=spans(text,merge_short_tail=False);index=0
    units=lambda value:len(value.encode('utf-16-le'))//2
    while index<len(values):
        value=values[index]
        if len(value.strip())<12:
            if index and units(values[index-1]+value)<=900:
                values[index-1]+=value;values.pop(index);continue
            if index+1<len(values) and units(value+values[index+1])<=900:
                values[index:index+2]=[value+values[index+1]];continue
        index+=1
    return values

def anchors(units,materials):
    speech=[];course=[]
    for i,unit in enumerate(units):
        for j,quote in enumerate(spans(unit['text'])):
            if quote.strip():speech.append({'id':'S%d.%d'%(i,j),'unit':unit['id'],'quote':quote,'uncertain':unit['uncertain']})
    for i,material in enumerate(materials):
        limits=material.get('limitations',[])
        if not isinstance(limits,list) or any(not isinstance(v,str) for v in limits):raise ValueError('Invalid material reading limitations')
        formula_ranges=[m.span() for m in re.finditer(r'<!-- formula-not-decoded -->|Unverified formula-region transcription:[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*',material['text'])]
        cursor=0
        for j,quote in enumerate(material_spans(material['text'])):
            end=cursor+len(quote)
            if quote.strip():course.append({'id':'M%d.%d'%(i,j),'material':material['id'],'quote':quote,'title':material['title'],**({'partial_sentence':True} if any('part of a long sentence' in v for v in limits) else {}),**({'unverified_formula':True} if any(cursor<right and left<end for left,right in formula_ranges) else {})})
            cursor=end
    return speech,course

def resolve(result,speech,course):
    for topic in result['topics']:
        evidence=[];connections=[]
        for field in ['examples','questions','conditions']:
            values=[]
            for ref in topic[field]:
                anchor=next((a for a in speech if a['id']==ref.get('anchor')),None)
                if not anchor:raise ValueError('Unsupported class detail anchor')
                values.append(anchor['quote'])
            topic[field]=values
        for ref in topic['evidence']:
            anchor=next((a for a in speech if a['id']==ref.get('anchor')),None)
            if not anchor:raise ValueError('Unsupported class anchor')
            evidence.append({'unit':anchor['unit'],'quote':anchor['quote']})
        for ref in topic['connections']:
            anchor=next((a for a in course if a['id']==ref.get('anchor')),None)
            if not anchor:raise ValueError('Unsupported material anchor')
            connections.append({'material':anchor['material'],'quote':anchor['quote'],'explanation':ref['explanation']})
        topic['evidence']=evidence;topic['connections']=connections
    return result
