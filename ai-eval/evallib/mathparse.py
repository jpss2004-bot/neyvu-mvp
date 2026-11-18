"""Turn a model's LaTeX/plain-text math into exact SymPy objects.

Model output is untrusted. Expressions are whitelisted (characters and identifiers)
before SymPy parses them with restricted globals, so no answer text can execute code.
"""
import re
from sympy import Float, Integer, Matrix, Rational, Symbol, nsimplify, pi, sqrt
from sympy.parsing.sympy_parser import (convert_xor, implicit_multiplication, parse_expr,
                                        standard_transformations)

TRANSFORMS = standard_transformations + (implicit_multiplication, convert_xor)
ALLOWED_FUNCTIONS = {'sqrt', 'Matrix', 'pi'}
IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
SAFE_CHARS = re.compile(r'^[0-9A-Za-z_+\-*/^().,\s\[\]]*$')
SYMBOL_NAME = re.compile(r'^[A-Za-z][0-9]{0,2}$')

SUBSCRIPTS = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')
SUPERSCRIPTS = {'²': '^{2}', '³': '^{3}', '¹': '^{1}', '⁴': '^{4}'}
UNICODE = [('\u2212', '-'), ('\u2013', '-'), ('\u2014', '-'), ('\u2010', '-'), ('\u2011', '-'), ('\u00a0', ' '),
           ('\u2009', ' '), ('\u202f', ' '), ('×', r' \times '), ('·', r' \cdot '), ('⋅', r' \cdot '), ('∗', '*'),
           ('≠', r' \neq '), ('≤', r' \le '), ('≥', r' \ge '), ('←', r' \leftarrow '), ('⟵', r' \leftarrow '),
           ('→', r' \rightarrow '), ('⟶', r' \rightarrow '), ('↔', r' \leftrightarrow '), ('⟷', r' \leftrightarrow '),
           ('⇒', r' \Rightarrow '), ('⟹', r' \Rightarrow '), ('∼', r' \sim '), ('≃', r' \simeq '), ('½', r'\frac{1}{2}'),
           ('⅓', r'\frac{1}{3}'), ('¼', r'\frac{1}{4}'), ('“', '"'), ('”', '"'), ('’', "'"), ('‘', "'")]


def normalize_text(text):
    """Normalize unicode math symbols to LaTeX-ish ASCII so one parser handles both."""
    if not text:
        return ''
    for old, new in UNICODE:
        text = text.replace(old, new)
    for old, new in SUPERSCRIPTS.items():
        text = text.replace(old, new)
    # x₁₂ -> x_{12}
    text = re.sub(r'([A-Za-z])([₀-₉]+)', lambda m: m.group(1) + '_{' + m.group(2).translate(SUBSCRIPTS) + '}', text)
    return text


def math_segments(text):
    """Math segments in reading order: $$..$$, \\[..\\], \\(..\\), $..$."""
    text = normalize_text(text)
    pattern = re.compile(r'\$\$(.+?)\$\$|\\\[(.+?)\\\]|\\\((.+?)\\\)|\$(.+?)\$', re.S)
    return [next(g for g in m.groups() if g is not None) for m in pattern.finditer(text)]


def _replace_command_with_braces(text, command, builder, arity):
    """Replace \\command{a}{b} (nested braces allowed) using builder(*args)."""
    out, i = [], 0
    token = '\\' + command
    while True:
        j = text.find(token, i)
        if j < 0:
            out.append(text[i:])
            return ''.join(out)
        after = j + len(token)
        if after < len(text) and text[after].isalpha():
            out.append(text[i:after])
            i = after
            continue
        out.append(text[i:j])
        k, args = after, []
        for _ in range(arity):
            while k < len(text) and text[k] == ' ':
                k += 1
            if k < len(text) and text[k] == '{':
                depth, start = 0, k
                while k < len(text):
                    if text[k] == '{':
                        depth += 1
                    elif text[k] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    k += 1
                args.append(text[start + 1:k])
                k += 1
            elif k < len(text):
                args.append(text[k])  # \frac12
                k += 1
        if len(args) < arity:
            out.append(text[j:])
            return ''.join(out)
        out.append(builder(*args))
        i = k


def latex_to_plain(expr):
    """Convert one LaTeX math expression into a SymPy-parsable string (not validated)."""
    s = normalize_text(expr)
    for cmd in ('left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'big', 'Big', 'displaystyle', 'textstyle'):
        s = re.sub(r'\\' + cmd + r'(?![A-Za-z])', '', s)
    s = re.sub(r'\\[,;:!> ]', ' ', s)
    s = re.sub(r'\\q?quad(?![A-Za-z])', ' ', s)
    s = s.replace('~', ' ')
    for cmd in ('text', 'mathrm', 'textbf', 'mathbf', 'boldsymbol', 'operatorname', 'mathit', 'textit', 'boxed', 'mathbb'):
        s = _replace_command_with_braces(s, cmd, lambda a: ' ' + a + ' ', 1)
    for cmd in ('dfrac', 'tfrac', 'frac'):
        s = _replace_command_with_braces(s, cmd, lambda a, b: '((' + a + ')/(' + b + '))', 2)
    s = _replace_command_with_braces(s, 'sqrt', lambda a: 'sqrt(' + a + ')', 1)
    s = re.sub(r'\\(?:cdot|times|ast)(?![A-Za-z])', '*', s)
    s = re.sub(r'\\pi(?![A-Za-z])', 'pi', s)
    s = re.sub(r'\\(?:lbrack|lbrace)(?![A-Za-z])', '(', s)
    s = re.sub(r'\\(?:rbrack|rbrace)(?![A-Za-z])', ')', s)
    s = re.sub(r'([A-Za-z])_\{\s*([A-Za-z0-9]+)\s*\}', r'\1\2', s)
    s = re.sub(r'([A-Za-z])_([A-Za-z0-9])', r'\1\2', s)
    s = re.sub(r'\^\{([^{}]*)\}', r'^(\1)', s)
    s = s.replace('{', '(').replace('}', ')')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def safe_parse(plain, symbols=None):
    """Parse a plain expression with SymPy after whitelisting. Returns None on failure."""
    if plain is None:
        return None
    plain = plain.strip().rstrip('.').strip()
    if not plain or len(plain) > 400 or '__' in plain or not SAFE_CHARS.match(plain):
        return None
    for name in IDENTIFIER.findall(plain):
        if name not in ALLOWED_FUNCTIONS and not SYMBOL_NAME.match(name):
            return None
    local = {name: Symbol(name) for name in (symbols or [])}
    globals_ = {'Integer': Integer, 'Float': Float, 'Rational': Rational, 'Symbol': Symbol, 'Matrix': Matrix,
                'sqrt': sqrt, 'pi': pi, '__builtins__': {}}
    try:
        value = parse_expr(plain, local_dict=local, global_dict=globals_, transformations=TRANSFORMS, evaluate=True)
    except Exception:
        return None
    try:
        if value.has(Float):
            value = nsimplify(value, rational=True)
    except Exception:
        pass
    return value


def parse_value(latex_or_plain, symbols=None):
    """Parse a LaTeX or plain value such as '\\frac{1}{2}', '-3', '3-8s'."""
    return safe_parse(latex_to_plain(latex_or_plain), symbols)


# ---------------------------------------------------------------- matrices
MATRIX_ENV = re.compile(r'\\begin\{(bmatrix|pmatrix|vmatrix|Bmatrix|Vmatrix|smallmatrix|matrix|array)\}'
                        r'(\{[^{}]*\})?(.*?)\\end\{\1\}', re.S)


def _matrix_from_rows(rows):
    parsed = []
    for row in rows:
        values = []
        for cell in row:
            v = parse_value(cell)
            if v is None:
                return None
            values.append(v)
        parsed.append(values)
    if not parsed or any(len(r) != len(parsed[0]) for r in parsed):
        return None
    return Matrix(parsed)


def extract_matrices(text):
    """Every LaTeX matrix (and [[..],[..]] list) in the text, in order, as exact matrices."""
    text = normalize_text(text)
    found = []
    for m in MATRIX_ENV.finditer(text):
        body = re.sub(r'\\hline', '', m.group(3))
        rows = []
        for raw in re.split(r'\\\\', body):
            if not raw.strip():
                continue
            cells = [c.strip() for c in raw.split('&')]
            cells = [c for c in cells if c not in ('', '|', '\\vert', '\\mid', '\\|', '||')]
            cells = [re.sub(r'^\|\s*|\s*\|$', '', c).strip() for c in cells]
            cells = [c for c in cells if c]
            rows.append(cells)
        matrix = _matrix_from_rows(rows)
        if matrix is not None:
            found.append((m.start(), matrix))
    for m in re.finditer(r'\[([^\[\]$]*;[^\[\]$]*)\]', text):
        rows = []
        for raw in m.group(1).split(';'):
            cells = [c for c in re.split(r'[\s,]+', raw.replace('|', ' ').strip()) if c]
            if cells:
                rows.append(cells)
        matrix = _matrix_from_rows(rows)
        if matrix is not None and matrix.rows > 1:
            found.append((m.start(), matrix))
    for m in re.finditer(r'\[\s*(\[[^\[\]]*\]\s*(?:,\s*\[[^\[\]]*\]\s*)*)\]', text):
        rows = [[c.strip() for c in r.split(',')] for r in re.findall(r'\[([^\[\]]*)\]', m.group(1))]
        matrix = _matrix_from_rows(rows)
        if matrix is not None and matrix.rows > 1:
            found.append((m.start(), matrix))
    found.sort(key=lambda x: x[0])
    return found


# ---------------------------------------------------------------- tuples and vectors
def _split_top_level(s, sep=','):
    parts, depth, current = [], 0, []
    for ch in s:
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(''.join(current))
            current = []
        else:
            current.append(ch)
    parts.append(''.join(current))
    return parts


def extract_tuples(text, length=None):
    """Parenthesised comma lists such as (2, 1/2) or \\left(-3, -2, 1\\right), parsed exactly."""
    plain = latex_to_plain(text)
    results = []
    for m in re.finditer(r'\(', plain):
        start, depth, k = m.start(), 0, m.start()
        while k < len(plain):
            if plain[k] == '(':
                depth += 1
            elif plain[k] == ')':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        if k >= len(plain):
            continue
        inner = plain[start + 1:k]
        parts = _split_top_level(inner)
        if len(parts) < 2 or (length and len(parts) != length):
            continue
        values = [safe_parse(p) for p in parts]
        if all(v is not None for v in values):
            results.append((start, values))
    return results


def parse_vector_combination(segment, length, params=('s', 't', 'r', 'u')):
    """Parse 'x = p + s v + t w' (column vectors or n-tuples) or a single parametric vector. Returns entries or None.

    Only the right-hand side of the last '=' is used, and trailing qualifiers such as
    "\\quad \\text{for } t \\in \\mathbb{R}" are ignored.
    """
    text = normalize_text(segment)
    text = re.sub(r'\\boxed\s*\{', '{', text)
    masked = MATRIX_ENV.sub(lambda m: 'M' * len(m.group(0)), text)  # '=' inside matrices never counts
    eq = masked.rfind('=')
    rhs = text[eq + 1:] if eq >= 0 else text
    masked_rhs = masked[eq + 1:] if eq >= 0 else masked
    cut = re.search(r'\\q?quad|\\text\s*\{\s*(?:for|where|with|and)|\bfor (?:all|any|some|every)?\s*[a-z]\b|\bwhere\b|\\in\b|,\s*[a-z]\s*\\in|\$|\\\]|\\end\{(?:align|equation|cases)', masked_rhs)
    if cut:
        rhs = rhs[:cut.start()]
    vectors = {}
    failed = []

    def matrix_placeholder(m):
        rows = [[c.strip() for c in raw.split('&') if c.strip()] for raw in re.split(r'\\\\', re.sub(r'\\hline', '', m.group(3))) if raw.strip()]
        matrix = _matrix_from_rows_symbolic(rows, params)
        if matrix is None or matrix.rows * matrix.cols != length or min(matrix.shape) != 1:
            failed.append(m.group(0))
            return ' 0 '
        name = 'V%d' % len(vectors)
        vectors[name] = list(matrix)
        return ' ' + name + ' '
    rhs = MATRIX_ENV.sub(matrix_placeholder, rhs)
    if failed:
        return None
    plain = latex_to_plain(rhs)

    def tuple_placeholder(m):
        parts = _split_top_level(m.group(1))
        if len(parts) != length:
            return m.group(0)
        values = [safe_parse(p, params) for p in parts]
        if any(v is None for v in values):
            return m.group(0)
        name = 'V%d' % len(vectors)
        vectors[name] = values
        return ' ' + name + ' '
    plain = re.sub(r'\(([^()]*(?:\([^()]*\)[^()]*)*)\)', tuple_placeholder, plain)
    if not vectors:
        return None
    if len(vectors) == 1 and not any(getattr(v, 'free_symbols', set()) for v in list(vectors.values())[0]):
        return None  # a lone numeric vector is a point, not a solution family
    expression = safe_parse(plain, list(params) + list(vectors))
    if expression is None:
        return None
    placeholders = [Symbol(name) for name in vectors]
    expression = expression.expand()
    coefficients = {p: expression.coeff(p) for p in placeholders}
    if any(c.has(*placeholders) for c in coefficients.values()):
        return None
    remainder = (expression - sum(c * p for p, c in coefficients.items())).expand()
    if remainder != 0:
        return None
    entries = [sum(coefficients[Symbol(name)] * vectors[name][i] for name in vectors) for i in range(length)]
    return [e.expand() for e in entries]


def _matrix_from_rows_symbolic(rows, params):
    parsed = []
    for row in rows:
        values = []
        for cell in row:
            v = parse_value(cell, params)
            if v is None:
                return None
            values.append(v)
        parsed.append(values)
    if not parsed or any(len(r) != len(parsed[0]) for r in parsed):
        return None
    return Matrix(parsed)


def column_vectors(text, length=None):
    vectors = []
    for pos, M in extract_matrices(text):
        if M.cols == 1 and (length is None or M.rows == length):
            vectors.append((pos, list(M)))
        elif M.rows == 1 and (length is None or M.cols == length) and M.cols > 1:
            vectors.append((pos, list(M)))
    return vectors


# ---------------------------------------------------------------- assignments like x_1 = 3 - 8s
PRECEDING_WORD = re.compile(r'(?:\band|\bso|\bthen|\bgives|\bis|\bwith|\bthat|\bhence|\bthus|\btherefore|\bget|'
                            r'\bhave|\bwhere|\\Rightarrow|\\implies|\\to|\\therefore|\\quad|\\qquad|\\\\|\\iff|'
                            r'\\begin\{[A-Za-z*]+\}(?:\{[^{}]*\})?)$')


def _assignment_context_ok(text, start):
    """The variable starts a statement (not the tail of an expression like 2x_1 + 5x_5 = 1)."""
    before = text[:start]
    stripped = before.rstrip(' \t')
    if not stripped or stripped.endswith('\n'):
        return True
    last = stripped[-1]
    if last in ',;:$([{&':
        return True
    if last == '.' and len(stripped) < len(before):
        return True  # end of a sentence followed by a space
    return bool(PRECEDING_WORD.search(stripped))


def variable_pattern(name):
    """Regex for a variable name such as x1 in its LaTeX/unicode spellings."""
    m = re.match(r'^([A-Za-z])(\d*)$', name)
    if not m:
        return re.escape(name)
    letter, digits = m.groups()
    if not digits:
        return letter + r'(?![A-Za-z0-9_])'
    return letter + r'(?:_\{\s*' + digits + r'\s*\}|_' + digits + r'(?!\d)|' + digits + r'(?!\d))'


def extract_assignments(text, names, symbols=None):
    """Map each variable name to the values assigned to it (`name = value`), in reading order."""
    text = normalize_text(text)
    out = {name: [] for name in names}
    for name in names:
        for m in re.finditer(r'(?<![A-Za-z0-9\\])' + variable_pattern(name) + r'\s*&?\s*(?:=|:=)\s*', text):
            if not _assignment_context_ok(text, m.start()):
                continue
            rhs = text[m.end():]
            stop = re.search(r'(?:,(?![^()]*\))|;|\n|\$|\\\\|\\quad|\\text|\band\b|\\Rightarrow|\\implies|\\le|\\ge|\\neq|'
                             r'&|\\end|(?<=\S)\.(?:\s|$)|\s(?:where|for|so|which|is|if|with|since)\b|=|\\\]|\\\))', rhs)
            value_text = rhs[:stop.start()] if stop else rhs[:80]
            value_text = value_text.strip()
            if value_text.count('(') < value_text.count(')'):
                value_text = value_text[:value_text.rfind(')')]
            while value_text.endswith('}') and value_text.count('{') < value_text.count('}'):
                value_text = value_text[:-1].rstrip()  # closing brace of \boxed{...} or \text{...}
            value = parse_value(value_text, symbols)
            if value is not None:
                out[name].append((m.start(), value))
    return out


# ---------------------------------------------------------------- linear equations a + b + c = 2
def extract_linear_equations(text, variables):
    """Linear equations in the given variables, as normalized coefficient rows [a, b, c | rhs]."""
    syms = [Symbol(v) for v in variables]
    rows = []
    cleaned = re.sub(r'\\(?:begin|end)\{[A-Za-z*]+\}', ' ', normalize_text(text))
    pieces = re.split(r'\n|;|\$|\\\\|\\quad|\\text\{[^}]*\}|,(?![^()]*\))|\band\b|\\\[|\\\]|&', cleaned)
    for piece in pieces:
        if piece.count('=') != 1:
            continue
        left, right = piece.split('=')
        lhs, rhs = parse_value(left, variables), parse_value(right, variables)
        if lhs is None or rhs is None:
            continue
        expression = (lhs - rhs).expand()
        if not expression.free_symbols or not expression.free_symbols <= set(syms):
            continue
        try:
            coefficients = [expression.coeff(s) for s in syms]
            constant = expression.subs({s: 0 for s in syms})
            if any(c.free_symbols for c in coefficients) or (expression - sum(c * s for c, s in zip(coefficients, syms)) - constant).expand() != 0:
                continue
        except Exception:
            continue
        rows.append(normalize_row(coefficients + [-constant]))
    return rows


def normalize_row(row):
    lead = next((x for x in row if x != 0), None)
    if lead is None:
        return tuple(row)
    return tuple(nsimplify(x / lead) for x in row)
