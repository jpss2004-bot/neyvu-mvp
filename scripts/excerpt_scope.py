"""Describe a pinned excerpt without claiming the whole vault was searched.

Coverage is a server observation about a saved-text representation, not proof
that an original was fully captured or that its author has course authority.
Malformed, legacy and subsequently edited excerpts remain usable as text, but
cannot inherit the original coverage claim. Python 3.9, no dependencies.
"""
import hashlib
import re

FORMAT = 'saved-text-excerpt/1'
RULE = ('Only the supplied excerpts were retrieved for this question. Coverage describes saved text, '
        'not the whole vault, the original file, a complete Moodle capture or verified author authority. '
        'An omitted passage may contain qualifications or a missing answer. Say a fact is not shown '
        'in these excerpts; never infer that it is absent from the vault. Keep supported facts useful, '
        'and ask for the original passage when its missing context affects the answer. '
        'Do not claim a complete list of requirements from partial or unknown coverage.')


def _integer(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def _characters(value):
    # The server counts JavaScript UTF-16 code units, not Python code points.
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def validated(source):
    value = source.get('excerpt_coverage')
    if not isinstance(value, dict) or value.get('format') != FORMAT:
        return None
    if value.get('unit_algorithm') not in (None, 'exact-sentence-groups/1', 'exact-sentence-groups/2', 'exact-section-groups/3', 'exact-section-groups/4', 'exact-section-groups/5', 'exact-section-groups/6', 'exact-section-groups/7', 'exact-section-groups/8'):
        return None
    if any(not isinstance(source.get(key), str) or not source[key]
           or value.get(field) != source[key]
           for key, field in [('id', 'source_id'), ('version_id', 'version_id')]):
        return None
    for key in ('text_sha256', 'excerpt_sha256'):
        if not isinstance(value.get(key), str) or not re.fullmatch('[0-9a-f]{64}', value[key]):
            return None
    excerpt = source.get('excerpt')
    if not isinstance(excerpt, str):
        return None
    try:
        if hashlib.sha256(excerpt.encode('utf-8')).hexdigest() != value['excerpt_sha256']:
            return None
    except UnicodeEncodeError:
        return None
    if any(not _integer(value.get(key)) for key in ('saved_characters', 'selected_units', 'partial_units')):
        return None
    if type(value.get('complete_saved_text')) is not bool or type(value.get('locations_truncated')) is not bool:
        return None
    trace = value.get('trace')
    if trace not in ('exact', 'ambiguous', 'untraced'):
        return None
    omitted = value.get('omitted_units')
    if (trace == 'exact' and not _integer(omitted)) or (trace != 'exact' and omitted is not None):
        return None
    for key in ('selected_locations', 'omitted_locations'):
        locations = value.get(key)
        if not isinstance(locations, list) or len(locations) > 4:
            return None
        for location in locations:
            if not isinstance(location, dict):
                return None
            low, high = location.get('start_line'), location.get('end_line')
            unit = location.get('unit')
            if (not _integer(low) or not _integer(high) or not 1 <= low <= high <= value['saved_characters'] + 1
                    or not (unit is None or isinstance(unit, str) and _characters(unit) <= 160)):
                return None
            if 'start_character' in location or 'end_character' in location:
                start, end = location.get('start_character'), location.get('end_character')
                if (value.get('unit_algorithm') not in ('exact-sentence-groups/1', 'exact-sentence-groups/2', 'exact-section-groups/3', 'exact-section-groups/4', 'exact-section-groups/5', 'exact-section-groups/6', 'exact-section-groups/7', 'exact-section-groups/8')
                        or not _integer(start) or not _integer(end) or not 0 <= start < end <= value['saved_characters']):
                    return None
            if key == 'omitted_locations' and location.get('reason') not in ('not_selected', 'partial_unit', 'untraced'):
                return None
    selected = value['selected_units']
    if selected + value['partial_units'] > value['saved_characters'] + 1:
        return None
    if len(value['selected_locations']) > selected:
        return None
    if trace == 'exact' and (len(value['omitted_locations']) > omitted or value['partial_units'] > omitted):
        return None
    if len(value['selected_locations']) != min(selected, 4):
        return None
    if trace == 'exact':
        if len(value['omitted_locations']) != min(omitted, 4):
            return None
        if any(item['reason'] == 'untraced' for item in value['omitted_locations']):
            return None
    elif len(value['omitted_locations']) != 1 or value['omitted_locations'][0]['reason'] != 'untraced':
        return None
    if value['locations_truncated'] != (selected > 4 or trace == 'exact' and omitted > 4):
        return None
    if value['complete_saved_text'] and (trace != 'exact' or omitted or value['partial_units'] or not selected
                                         or not value['saved_characters'] or not excerpt.strip()):
        return None
    if trace == 'exact' and not value['complete_saved_text'] and selected and omitted == 0:
        return None
    # A digest binds the supplied excerpt. We cannot independently check the
    # saved-text digest without that text; this is not a trust/capture upgrade.
    return value


def note(source, cite):
    value = validated(source)
    prefix = 'Excerpt coverage [%d]: ' % cite
    device=source.get('device_content_observation')
    if isinstance(device,dict) and device.get('format')=='device-content-observation/1':
        prefix+='Device-observed PDF text; original identity, physical-page completeness, equations and layout are not independently verified. Original recovery may require the collecting Companion. '
    if value is None:
        return prefix + 'unknown (metadata absent, invalid or text changed); do not assume complete saved text.'
    if value['complete_saved_text']:
        return prefix + 'all saved text represented; original capture completeness and authority are not established.'
    def locations(items):
        # Heading labels are untrusted source wording. Line numbers suffice as
        # locators and cannot introduce extra instructions into the prompt.
        return ', '.join('lines %d-%d' % (item['start_line'], item['end_line'])
                         + (' (UTF-16 characters %d-%d)' % (item['start_character'], item['end_character'])
                            if 'start_character' in item else '') for item in items) or 'not located'
    if value['trace'] != 'exact':
        return prefix + 'partial; exact passage mapping is %s. Review saved text at %s.' % (
            value['trace'], locations(value['omitted_locations']))
    return prefix + 'partial; %d saved-text units omitted (%s); %d partially quoted units.%s' % (
        value['omitted_units'], locations(value['omitted_locations']), value['partial_units'],
        ' Location list is limited.' if value['locations_truncated'] else '')


# Preserve quoted source wording and code. Scope the assistant's own absence
# statements, without changing positive facts or supported explicit negatives
# such as "There is no final exam".
OPAQUE = re.compile(r'```[\s\S]*?```|~~~[\s\S]*?~~~|(?m:^\s*>[^\n]*(?:\n\s*>[^\n]*)*)|`[^`\n]+`|"[^"\n]+"|“[^”\n]+”|‘[^’\n]+’')
REPLACEMENTS = (
    (r'\b(?:the|your) saved sources (do not|don\x27t|cannot|can\x27t)\b', r'The retrieved excerpts \1'),
    (r'\b(?:the|your) saved (?:sources|material|files) (does not|doesn\x27t)\b', 'The retrieved material does not'),
    (r'\b(is|are) not (?:yet )?in (?:the |your )?(?:saved sources|vault|saved material|saved files)(?: yet)?\b',
     r'\1 not shown in the excerpts retrieved for this question'),
    (r'\bnot found in (?:the |your )?(?:saved sources|vault|saved material|saved files)\b',
     'not found in the excerpts retrieved for this question'),
    (r'\b(cannot confirm[^.\n]{0,160}) from (?:the |your )?saved sources\b', r'\1 from the retrieved excerpts'),
    (r'\b(?:Las|Tus) fuentes guardadas no\b', 'Los fragmentos recuperados no'),
    (r'\bno (?:est[aá]|aparece|figura|se encuentra)(?: todav[ií]a| a[uú]n)? en (?:las fuentes guardadas|tu b[oó]veda|la b[oó]veda)\b',
     'no se muestra en los fragmentos recuperados para esta pregunta'),
)


def bound_absence(text):
    def prose(value):
        for pattern, replacement in REPLACEMENTS:
            value = re.sub(pattern, replacement, value, flags=re.I)
        return value
    pieces = []
    previous = 0
    for match in OPAQUE.finditer(text):
        pieces.extend((prose(text[previous:match.start()]), match.group()))
        previous = match.end()
    pieces.append(prose(text[previous:]))
    return ''.join(pieces)
