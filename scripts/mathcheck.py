"""Exact linear-algebra checks for SchoolVault answers (user decision 2026-10-01).

When a question contains a computation this module can do exactly (determinant,
inverse, inverse mod n, row reduction, rank, eigenvalues, null space, product,
transpose, or a linear system), the worker computes it first with SymPy and gives
the model the verified values. Computed answers are published from the engine's
ordered results and operations. Model wording cannot establish equality just by
containing the expected numbers, and is not certified by these calculations.

Input is read with strict number patterns and Rational(); nothing from a
question is ever evaluated as code. Runs on Python 3.9 (the mini's worker).
"""
import re
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from itertools import combinations
from math import gcd

try:
    from sympy import Matrix, Pow, Rational, Symbol, Eq, Ne, And, Or, latex, linsolve, symbols, simplify, Poly, isprime, E, pi, log, sqrt, asin, diff, limit, oo, __version__ as SYMPY_VERSION
    AVAILABLE = True
except Exception:  # the worker keeps answering without checks
    AVAILABLE = False

MAX_DIM = 8
MAX_EIGEN_DIM = 4
NUMBER = r'[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:/\d+)?'
NUMBER_RE = re.compile('^' + NUMBER + '$')
LABEL = ('*AI-written study material: check it against your course notes, '
         "and don't submit it as your own work.*")
OPS = [
    ('rref', re.compile(r'\brref\b|row[\s-]*reduc|reduced row[\s-]*echelon|echelon form|gauss', re.I)),
    ('inverse', re.compile(r'\binver(?:se|t|ting|tible)\b|\^\s*\{?\s*-1|\u207b\u00b9', re.I)),
    ('det', re.compile(r'\bdet(?:erminant)?\b|vmatrix', re.I)),
    ('rank', re.compile(r'\brank\b', re.I)),
    ('eigen', re.compile(r'\beigen', re.I)),
    ('nullspace', re.compile(r'null[\s-]*space|\bkernel\b', re.I)),
    ('transpose', re.compile(r'\btranspose\b', re.I)),
    ('product', re.compile(r'\bproduct\b|\bmultipl(?:y|ication)\b', re.I)),
]
SOLVE_RE = re.compile(r'\bsolve\b|\bsolutions?\b|\bsystem\b|\bconsistent\b', re.I)
MOD_RE = re.compile(r'\bmod(?:ulo)?\s*([-+]?\d+(?:\.\d+)?)\b|\bGF\s*\(\s*([-+]?\d+)\s*\)|(?<![A-Za-z])(?:Z|ℤ|F|𝔽)[_ ]?([-+]?\d+)\b', re.I)
SUBSCRIPT_DIGITS = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')
VERB_RE = re.compile(r'\b(solve|find|compute|calculate|determine|show that|prove|simplify|evaluate|row[\s-]*reduce|work out)\b', re.I)
MATHY_RE = re.compile(r'[=\[\]^\\]|\bmatri|\bvector|\bequation|\bsystem\b|\bdeterminant|\beigen', re.I)
VAR = r'[a-z](?:_?\d{1,2})?'
TERM_RE = re.compile(r'([+-])(\d+(?:\.\d+)?(?:/\d+)?)?\*?(' + VAR + r')?')


def _entry(text):
    t = text.strip().replace('\u2212', '-')
    if len(t)>64:return None
    if re.fullmatch('[a-z]',t):return Symbol(t)
    return Rational(t) if NUMBER_RE.match(t) else None


def _matrix(rows):
    if not rows or any(not r or any(e is None for e in r) for r in rows):
        return None
    width = len(rows[0])
    if any(len(r) != width for r in rows) or len(rows) > MAX_DIM or width > MAX_DIM:
        return None
    return Matrix(rows)


def find_matrices(text):
    """Matrices written as [[1,2],[3,4]], [1 2; 3 4] or a LaTeX matrix, in order of appearance."""
    found = []
    for m in re.finditer(r'\[\s*\[(.*?)\]\s*\]', text, re.S):
        rows = [[_entry(x) for x in re.split(r'[,|\s]+', r.strip()) if x]
                for r in re.split(r'\]\s*,\s*\[', m.group(1))]
        found.append((m.start(), _matrix(rows)))
    for m in re.finditer(r'(?<!\[)\[([^\[\]]*;[^\[\]]*)\]', text):
        rows = [[_entry(x) for x in re.split(r'[,|\s]+', r.strip()) if x] for r in m.group(1).split(';')]
        found.append((m.start(), _matrix(rows)))
    for m in re.finditer(r'\\begin\{([bpvB]?matrix)\}(.*?)\\end\{\1\}', text, re.S):
        rows = [[_entry(x) for x in r.split('&')] for r in m.group(2).split('\\\\') if r.strip()]
        found.append((m.start(), _matrix(rows)))
    return [mat for _, mat in sorted(found, key=lambda pair: pair[0]) if mat is not None]


def _side(expr):
    expr = expr.replace(' ', '').replace('\u2212', '-').replace('\u00b7', '*')
    if not expr:
        return None
    if expr[0] not in '+-':
        expr = '+' + expr
    coeffs, const, pos = {}, Rational(0), 0
    for m in TERM_RE.finditer(expr):
        if m.start() != pos or (not m.group(2) and not m.group(3)):
            return None
        pos = m.end()
        sign = -1 if m.group(1) == '-' else 1
        value = Rational(m.group(2)) if m.group(2) else Rational(1)
        if m.group(3):
            name = m.group(3).replace('_', '')
            coeffs[name] = coeffs.get(name, 0) + sign * value
        else:
            const += sign * value
    return (coeffs, const) if pos == len(expr) else None


# One standard-form linear equation: a combination of variables equals a number,
# e.g. "2x - y = 1" or "x_1 + 3x_2 = 0". Found anywhere in the text, so words around
# it ("Solve ... and ...") don't matter; products like "xy" never match.
_TERM = r'(?:\d+(?:\.\d+)?(?:/\d+)?\s*\*?\s*)?' + VAR
EQ_RE = re.compile(r'(?<![a-z0-9_.])((?:[-+]\s*)?' + _TERM + r'(?:\s*[-+]\s*' + _TERM + r')*)'
                   r'\s*=\s*([-+]?\s*\d+(?:\.\d+)?(?:/\d+)?)(?!\w|\.\d)')


def find_system(text):
    """A linear system (at least two equations, at most MAX_DIM unknowns), or None."""
    equations = []
    for m in EQ_RE.finditer(text.lower().replace('\u2212', '-')):
        lhs, rhs = _side(m.group(1)), _side(m.group(2))
        if lhs and rhs and lhs[0]:
            equations.append((lhs, rhs))
    if len(equations) < 2:
        return None
    names = sorted({n for (l, _), (r, _) in equations for n in list(l) + list(r)},
                   key=lambda n: (n[0], int(n[1:] or 0)))
    if not names or len(names) > MAX_DIM:
        return None
    order=re.search(r'variables?\s+(?:in\s+the\s+order\s+)?([a-z0-9_,\s]+)',text.lower())
    if order:
        given=re.findall(VAR,order.group(1))
        if len(given)==len(names) and set(given)==set(names):names=given
    rows = [[l.get(n, 0) - r.get(n, 0) for n in names] + [rc - lc] for (l, lc), (r, rc) in equations]
    return names, Matrix(rows)


def _tex(value):
    return latex(value, mat_str='bmatrix', mat_delim='')


def domain_text(question):
    value = question.translate(SUBSCRIPT_DIGITS).replace('\\mathbb{Z}', 'Z').replace('\\mathbb{F}', 'F')
    return re.sub(r'([ZℤF𝔽])_\{\s*([-+]?\d+)\s*\}', r'\1_\2', value)


def domain_declarations(question):
    value = domain_text(question)
    declarations = []
    for match in MOD_RE.finditer(value):
        # An indexed matrix label such as F_5 is not a number system. Require
        # explicit arithmetic/field context around an indexed domain symbol.
        if match.group(3):
            before, after = value[max(0, match.start()-60):match.start()], value[match.end():]
            if not re.search(r'\b(?:over|in|within|(?:number system|field|ring)\s*:?)\s*(?:the\s+)?(?:field\s+|ring\s+)?$', before, re.I) and not re.match(r'\s*(?:arithmetic|field|ring)\b', after, re.I):
                continue
            if re.match(r'\s*\^', after): raise ValueError('Confirm the field definition for this powered domain notation.')
        declarations.append(match)
    return declarations


def modulus_of(question):
    domain = domain_text(question)
    values = [next(v for v in match.groups() if v) for match in domain_declarations(question)]
    if not values:
        if re.search(r'\bmod(?:ulo)?\b|\bGF\s*\(|\b(?:over|in)\s+(?:the\s+)?[ZℤF𝔽][_]\S', domain, re.I):
            raise ValueError('Confirm the numeric modulus or field definition before this calculation.')
        return None
    if any(not re.fullmatch(r'\+?\d{1,4}', v) for v in values):
        raise ValueError('Use an integer modulus between 2 and 9999.')
    mods = {int(v) for v in values}
    if len(mods) != 1 or next(iter(mods)) < 2:
        raise ValueError('Confirm one integer modulus greater than one for this calculation.')
    return next(iter(mods))


def unsupported_domain(question):
    """Hold concrete modular work whose domain this engine cannot check."""
    try:
        modulus = modulus_of(question)
    except ValueError as error:
        return str(error)
    if modulus is None:
        return None
    mats = find_matrices(question)
    system = find_system(question)
    field = any(m.group(2) or m.group(3) and m.group(0)[0] in 'Ff𝔽' for m in domain_declarations(question))
    if field and not isprime(modulus):
        return 'An extension field is not the same as integer arithmetic modulo a composite number. Add the field definition and course method before this calculation.'
    if re.search(r'passes through|associated homogeneous', question, re.I) and not mats and not system:
        return 'Provide the integer augmented matrix for this modular problem; this input form is not checked yet.'
    if not mats and not system:
        return None
    if any(not v.is_Integer for m in mats + ([system[1]] if system else []) for v in m):
        return 'Confirm integer entries and the intended modular number system before this calculation.'
    if re.search(r'\beigen', question, re.I):
        return 'Modular eigenvalue calculations are not checked by this engine. Add the course method for review.'
    field_work = bool(system or re.search(r'row[\s-]*reduc|rref|echelon|gauss|\brank\b|null[\s-]*space|kernel|pivot|free variable|consistent|unique|solution|\bsolve\b|passes through', question, re.I))
    if field_work and (modulus > 997 or not isprime(modulus)):
        return 'This row-reduction and linear-system checker requires a prime modulus up to 997. A composite modulus needs its own course method; it cannot use ordinary rational elimination.'
    return None


def rref_steps(matrix, modulus=None):
    """Gauss-Jordan elimination with each row operation recorded in course notation."""
    if modulus and (modulus > 997 or not isprime(modulus) or any(not v.is_Integer for v in matrix)):
        raise ValueError('Modular elimination requires integer entries over a qualified prime field')
    a = matrix.applyfunc(lambda v: int(v) % modulus) if modulus else matrix.copy()
    rows, cols = a.shape
    steps, pivots, r = [], [], 0
    for c in range(cols):
        if r >= rows:
            break
        p = next((i for i in range(r, rows) if a[i, c] != 0), None)
        if p is None:
            continue
        if p != r:
            a.row_swap(p, r)
            steps.append('$R_{%d} \\leftrightarrow R_{%d}$' % (r + 1, p + 1))
        if a[r, c] != 1:
            factor = Rational(pow(int(a[r, c]), -1, modulus)) if modulus else 1 / a[r, c]
            a[r, :] = a[r, :] * factor
            if modulus:
                a[r, :] = a[r, :].applyfunc(lambda v: int(v) % modulus)
            steps.append('$R_{%d} \\leftarrow %s R_{%d}$' % (r + 1, _tex(factor), r + 1))
        for i in range(rows):
            if i != r and a[i, c] != 0:
                f = a[i, c]
                a[i, :] = a[i, :] - f * a[r, :]
                if modulus:
                    a[i, :] = a[i, :].applyfunc(lambda v: int(v) % modulus)
                coef = '' if abs(f) == 1 else _tex(abs(f))
                steps.append('$R_{%d} \\leftarrow R_{%d} %s %sR_{%d}$' % (i + 1, i + 1, '-' if f > 0 else '+', coef, r + 1))
        pivots.append(c)
        r += 1
    return a, pivots, steps


def matrix_rank(matrix, modulus=None):
    return len(rref_steps(matrix, modulus)[1]) if modulus else matrix.rank()


def modular_solution(names, augmented, modulus):
    r, pivots, steps = rref_steps(augmented, modulus)
    n = len(names)
    if n in pivots:
        return _result('system', 'The system is inconsistent modulo %d: no solution.' % modulus, [], steps, ['no solution|inconsistent'])
    free = [c for c in range(n) if c not in pivots]
    particular = Matrix([0] * n)
    for row, column in enumerate(pivots):
        particular[column] = r[row, n]
    basis = []
    for column in free:
        direction = Matrix([0] * n); direction[column] = 1
        for row, pivot in enumerate(pivots):
            direction[pivot] = -r[row, column] % modulus
        basis.append(direction)
    a, b = augmented[:, :-1], augmented[:, -1]
    assert (a * particular - b).applyfunc(lambda v: int(v) % modulus) == Matrix.zeros(a.rows, 1)
    assert all((a * direction).applyfunc(lambda v: int(v) % modulus) == Matrix.zeros(a.rows, 1) for direction in basis)
    if not free:
        summary = 'Unique solution modulo %d: ' % modulus + ', '.join('$%s = %s$' % (name, _tex(v)) for name, v in zip(names, particular))
        return _result('system', summary, list(particular), steps)
    terms = [_tex(particular)] + ['t_{%d} %s' % (i + 1, _tex(direction)) for i, direction in enumerate(basis)]
    summary = '%d solutions modulo %d. In variable order (%s), $%s \\pmod{%d}$, with each $t_i$ in $\\{0,\\ldots,%d\\}$.\n\nBasic homogeneous directions: %s.' % (modulus ** len(free), modulus, ', '.join(names), ' + '.join(terms), modulus, modulus - 1, ', '.join('$' + _tex(v) + '$' for v in basis))
    return _result('system', summary, [], steps, ['solutions modulo'])


def _result(kind, summary, keys, steps=(), phrases=()):
    return {'kind': kind, 'summary': summary, 'keys': [k for k in keys if k is not None], 'steps': list(steps),
            'phrases': list(phrases)}


def compute(op, mats, modulus=None):
    a = mats[0]
    if op == 'det':
        if not a.is_square:
            return None
        d = a.det() % modulus if modulus else a.det()
        return _result('det', '$\\det(A) = %s$' % _tex(d), [d])
    if op == 'inverse':
        if not a.is_square:
            return None
        if modulus:
            if gcd(int(a.det()), modulus) != 1:
                return _result('inverse', '$A$ is not invertible modulo %d.' % modulus, [], phrases=['not invertible'])
            inv = a.inv_mod(modulus)
            assert (a * inv).applyfunc(lambda v: int(v) % modulus) == Matrix.eye(a.rows)
            return _result('inverse', '$A^{-1} \\equiv %s \\pmod{%d}$' % (_tex(inv), modulus), list(inv))
        d = a.det()
        if d == 0:
            return _result('inverse', '$\\det(A) = 0$, so $A$ is not invertible.', [], phrases=['not invertible'])
        inv = a.inv()
        assert a * inv == Matrix.eye(a.rows)
        return _result('inverse', '$A^{-1} = %s$' % _tex(inv), list(inv))
    if op == 'rref':
        r, pivots, steps = rref_steps(a, modulus)
        if not modulus:
            assert r == a.rref()[0]
        cols = ', '.join(str(p + 1) for p in pivots) or 'none'
        return _result('rref', 'RREF: $%s$ (pivot columns: %s)' % (_tex(r), cols), list(r), steps)
    if op == 'rank':
        rank = matrix_rank(a, modulus)
        return _result('rank', '$\\operatorname{rank}(A) = %d$' % rank, [Rational(rank)])
    if op == 'eigen':
        if not a.is_square or a.shape[0] > MAX_EIGEN_DIM:
            return None
        vals = a.eigenvals()
        text = ', '.join('$\\lambda = %s$%s' % (_tex(v), '' if m == 1 else ' (multiplicity %d)' % m) for v, m in vals.items())
        keys = [v for v in vals if v.is_Rational]
        radicands = sorted({str(p.base) for v in vals for p in v.atoms(Pow) if p.exp == Rational(1, 2)})
        return _result('eigen', 'Eigenvalues: ' + text, keys, phrases=['sqrt:' + r for r in radicands])
    if op == 'nullspace':
        if modulus:
            r, pivots, _ = rref_steps(a, modulus); basis = []
            for column in range(a.cols):
                if column in pivots: continue
                direction = Matrix([0] * a.cols); direction[column] = 1
                for row, pivot in enumerate(pivots): direction[pivot] = -r[row, column] % modulus
                assert (a * direction).applyfunc(lambda v: int(v) % modulus) == Matrix.zeros(a.rows, 1)
                basis.append(direction)
        else:
            basis = a.nullspace()
        if not basis:
            return _result('nullspace', 'Null space: only the zero vector.', [], phrases=['zero vector|trivial|only the zero'])
        return _result('nullspace', 'Null space basis: ' + ', '.join('$%s$' % _tex(v) for v in basis),
                       [x for v in basis for x in v])
    if op == 'transpose':
        value = a.T.applyfunc(lambda v: int(v) % modulus) if modulus else a.T
        return _result('transpose', '$A^{T} = %s$' % _tex(value), list(value))
    if op == 'product':
        if len(mats) < 2 or a.shape[1] != mats[1].shape[0]:
            return None
        p = a * mats[1]
        if modulus: p = p.applyfunc(lambda v: int(v) % modulus)
        return _result('product', '$AB = %s$' % _tex(p), list(p))
    return None


def solve_system(names, augmented, modulus=None):
    if modulus: return modular_solution(names, augmented, modulus)
    a, b = augmented[:, :-1], augmented[:, -1]
    r, pivots, steps = rref_steps(augmented)
    n = len(names)
    if n in pivots:
        return _result('system', 'The system is inconsistent: no solution.', [], steps,
                       ['no solution|inconsistent'])
    syms = symbols(' '.join(names))
    syms = syms if isinstance(syms, tuple) else (syms,)
    sol = list(linsolve((a, b), *syms))[0]
    if len(pivots) == n:
        text = ', '.join('$%s = %s$' % (name, _tex(v)) for name, v in zip(names, sol))
        return _result('system', 'Unique solution: ' + text, list(sol), steps)
    free = [names[c] for c in range(n) if c not in pivots]
    free_symbols=[syms[c] for c in range(n) if c not in pivots]
    particular=Matrix(sol).subs({v:0 for v in free_symbols})
    basis=[Matrix(sol).diff(v) for v in free_symbols]
    vector=' + '.join([_tex(particular)]+[_tex(v)+' '+_tex(b) for v,b in zip(free_symbols,basis)])
    text = ', '.join('$%s = %s$' % (name, _tex(v)) for name, v in zip(names, sol))
    return _result('system', 'Infinitely many solutions (free: %s): %s\n\nIn variable order (%s), particular solution + homogeneous solution: $%s$.\n\nBasic solutions: %s.' % (', '.join(free),text,', '.join(names),vector,', '.join('$'+_tex(b)+'$' for b in basis)), [], steps,['infinitely many'])

def parameter_conditions(matrix,question):
    """Exact rank conditions from minors, with bounded symbolic dimensions."""
    if matrix.rows>4 or matrix.cols>5 or len(matrix.free_symbols)>2:return None
    a=matrix[:,:-1];n=a.cols
    def condition(expression,equal):
        expression=simplify(expression)
        syms=list(expression.free_symbols)
        if len(syms)==1:
            p=Poly(expression,syms[0])
            if p.degree()==1:
                expression=syms[0]-(-p.nth(0)/p.nth(1))
        return (Eq if equal else Ne)(expression,0)
    def minors(m,k):
        if k==0:return [Rational(1)]
        if k>min(m.shape):return []
        return [m.extract(rows,cols).det() for rows in combinations(range(m.rows),k) for cols in combinations(range(m.cols),k)]
    def rank_eq(m,k):return And(Or(*[condition(v,False) for v in minors(m,k)]),And(*[condition(v,True) for v in minors(m,k+1)]))
    unique=And(rank_eq(a,n),rank_eq(matrix,n))
    infinite=Or(*[And(rank_eq(a,k),rank_eq(matrix,k)) for k in range(n)])
    inconsistent=Or(*[And(rank_eq(a,k),Or(*[condition(v,False) for v in minors(matrix,k+1)])) for k in range(min(a.shape)+1)])
    if re.search(r'no solution|inconsistent',question,re.I):label='No solution';answer=inconsistent
    elif re.search(r'infinite',question,re.I):label='Infinitely many solutions';answer=infinite
    elif re.search(r'unique|exactly one',question,re.I):label='Exactly one solution';answer=unique
    else:return None
    answer=simplify(answer)
    parameters=', '.join(str(v) for v in sorted(matrix.free_symbols,key=str))
    desc='for every value of '+parameters if answer==True else 'for no value of '+parameters if answer==False else 'when '+(' and '.join('$'+_tex(v)+'$' for v in answer.args) if answer.func==And else '$'+_tex(answer)+'$')
    summary = label+' '+desc+'. This follows by comparing the coefficient and augmented ranks.'
    # For a single exact exceptional value, show an independently reduced
    # contradictory row. Do not treat a generic symbolic RREF as valid at a
    # singular parameter value; substitute first, then reduce the numeric matrix.
    if label == 'No solution' and isinstance(answer, Eq) and answer.lhs.is_Symbol and not answer.rhs.free_symbols:
        substituted = matrix.subs(answer.lhs, answer.rhs)
        if not substituted.free_symbols:
            reduced, _ = substituted.rref()
            contradictions = [i for i in range(reduced.rows)
                              if all(reduced[i,j] == 0 for j in range(n)) and reduced[i,n] != 0]
            if contradictions:
                rank_a, rank_aug = substituted[:,:-1].rank(), substituted.rank()
                assert rank_a < rank_aug
                row = reduced[contradictions[0],:]
                summary += (' At $%s = %s$, the coefficient rank is %d and augmented rank is %d. '
                            'Reducing the substituted augmented matrix gives the row $%s$, '
                            'which says $0 = %s$: a contradiction, so there is no solution.'
                            % (_tex(answer.lhs), _tex(answer.rhs), rank_a, rank_aug, _tex(row), _tex(row[0,n])))
    return _result('parameters',summary,[],phrases=[])


def analyze(question):
    """Verified results for every exact computation found in the question; never raises."""
    if not AVAILABLE:
        return []
    try:
        mats = find_matrices(question)
        if unsupported_domain(question): return []
        modulus = modulus_of(question)
        results = []
        if re.search(r'associated homogeneous',question,re.I) and re.search(r'\bis\b.*solution',question,re.I):
            numeric=[[_entry(v) for v in group.split(',')] for group in re.findall(r'\(\s*('+NUMBER+r'(?:\s*,\s*'+NUMBER+r'){1,7})\s*\)',question)]
            family=re.search(r'\(([a-z](?:\s*,\s*[a-z]){1,7})\)\s*=\s*\(([^()]*)\)',question)
            if len(numeric)==2 and family:
                expressions=[_side(v.strip()) for v in family.group(2).split(',')]
                if len(numeric[0])==len(numeric[1])==len(expressions) and all(expressions) and all(e[1]==0 for e in expressions):
                    params=sorted({p for e in expressions for p in e[0]});directions=Matrix([[e[0].get(p,0) for p in params] for e in expressions]);delta=Matrix(numeric[1])-Matrix(numeric[0]);valid=matrix_rank(directions,modulus)==matrix_rank(directions.row_join(delta),modulus)
                    return [_result('check',('Yes, it is a solution.' if valid else 'No, it is not a solution.')+' The difference from the known solution is $'+_tex(delta)+'$; '+('it lies' if valid else 'it does not lie')+' in the homogeneous solution space spanned by the columns of $'+_tex(directions)+'$.',[],phrases=['yes' if valid else 'no'])]
        if re.search(r'true or false',question,re.I) and (re.search(r'inconsistent',question,re.I) and re.search(r'cannot.*pivot.*every column',question,re.I) or re.search(r'augmented.*pivot.*every row.*consistent',question,re.I)):
            example=Matrix([[1,0,0],[0,1,0],[0,0,1]])
            assert example[:,:-1].rank()==2 and example.rank()==3
            return [_result('counterexample','False. The augmented RREF $%s$ has pivots in both coefficient columns, yet its last row is $0=1$, so it is inconsistent.'%_tex(example),[],phrases=['false'])]
        polynomial=re.search(r'y\s*=\s*([a-wyz])\s*\+\s*([a-wyz])x\s*\+\s*([a-wyz])x(?:\^2|²)',question)
        if polynomial and re.search(r'passes through',question,re.I):
            points=[(_entry(x),_entry(y)) for x,y in re.findall(r'\(\s*('+NUMBER+r')\s*,\s*('+NUMBER+r')\s*\)',question)]
            if len(points)==3 and all(x is not None and y is not None for x,y in points):
                names=list(polynomial.groups());aug=Matrix([[1,x,x*x,y] for x,y in points])
                equations=[]
                for row in aug.tolist():equations.append('$'+_tex(sum(row[j]*Symbol(names[j]) for j in range(3)))+' = '+_tex(row[-1])+'$')
                if re.search(r'do not solve|just set up',question,re.I):return [_result('setup','The required system is: '+', '.join(equations)+'.',[])]
                return [solve_system(names,aug,modulus)]
        if mats:
            if any(m.free_symbols for m in mats):
                result=parameter_conditions(mats[0],question) if len(mats)==1 else None
                return [result] if result else []
            # Echelon/pivot questions concern the coefficient columns; the
            # augmentation separator belongs to numeric matrix syntax.
            augmented=bool(re.search(r'\[[^\]]*\|',question))
            if re.search(r'which.*(?:consistent|unique|exactly one)|(?:consistent|unique|exactly one).*which',question,re.I) and len(mats)>1:
                labels=re.findall(r'\b([A-Z])\s*=\s*\[',question)
                if len(labels)==len(mats):
                    unique=bool(re.search(r'unique|exactly one',question,re.I))
                    good=[label for label,m in zip(labels,mats) if matrix_rank(m[:,:-1],modulus)==matrix_rank(m,modulus) and (not unique or matrix_rank(m,modulus)==m.cols-1)]
                    return [_result('consistency',('Systems with a unique solution: ' if unique else 'Consistent systems: ')+(', '.join(good) or 'none')+'.',[],phrases=['unique' if unique else 'consistent'])]
            if re.search(r'pivot positions?|pivot columns?|variables? (?:are )?free|free variables?',question,re.I):
                m=mats[0];n=m.cols-1 if augmented else m.cols;r,pivots,steps=rref_steps(m,modulus)
                piv=[p for p in pivots if p<n]
                free=['x%d'%(p+1) for p in range(n) if p not in piv]
                positions=[(next(i+1 for i in range(r.rows) if r[i,p]!=0),p+1) for p in piv]
                summary='Pivot columns: '+', '.join(str(p+1) for p in piv)+'. Pivot positions (row, column): '+', '.join(str(v) for v in positions)+'. '+(', '.join(free)+' are free variables.' if free else 'There are no free variables.')
                return [_result('pivots',summary,[],steps)]
            if augmented and re.search(r'general solution|particular solution|homogeneous solution|solve|solution of|infinitely many solutions',question,re.I):
                result=solve_system(['x%d'%(i+1) for i in range(mats[0].cols-1)],mats[0],modulus)
                if not modulus and re.search(r'free|infinitely many',question,re.I):result['summary']+=' A free variable gives infinitely many solutions only if the system is consistent; a contradictory row gives no solution.'
                return [result]
            for op, pattern in OPS:
                if pattern.search(question):
                    res = compute(op, mats, modulus)
                    if res:results.append(res)
            if not results and SOLVE_RE.search(question) and mats[0].shape[1] >= 2:
                results.append(solve_system(['x%d' % (i + 1) for i in range(mats[0].cols-1)], mats[0],modulus))
        if not results:
            system = find_system(question)
            if system:
                vector=re.search(r'\(([^()]*)\)\s*(?:a solution|solves)',question,re.I)
                if vector and re.search(r'check|whether|\bis\b',question,re.I):
                    values=[_entry(v) for v in vector.group(1).split(',')]
                    if len(values)==len(system[0]) and all(v is not None for v in values):
                        a=system[1][:,:-1];b=system[1][:,-1];actual=a*Matrix(values)
                        verdict=(actual-b).applyfunc(lambda v: int(v) % modulus)==Matrix.zeros(b.rows,1) if modulus else actual==b
                        return [_result('check','%s. Substitution gives $A x = %s$, and the required right-hand side is $b = %s$.'%('Yes, it is a solution' if verdict else 'No, it is not a solution',_tex(actual),_tex(b)),[],phrases=['yes' if verdict else 'no'])]
                results.append(solve_system(*system,modulus=modulus))
        return results
    except Exception:
        return []


def prompt_block(results):
    lines = ['Verified computation (exact arithmetic with SymPy). Use these values exactly, explain the steps in the '
             "course's notation (row operations like $R_2 \\to R_2 - 2R_1$, keep the question's variable names), and "
             'never contradict them:']
    for res in results:
        lines.append('- ' + res['summary'])
        if res['steps']:
            lines.append('  Row operations: ' + '; '.join(res['steps']))
    return '\n'.join(lines)


def needs_label(question, results):
    return bool(results) or bool(VERB_RE.search(question) and MATHY_RE.search(question))


def finalize(question, answer, results):
    """Publish computed work from ordered engine results, never a bag of numbers.

    These checks cannot prove the model's prose, intermediate equalities or a
    whole assignment. Preserve the exact worked calculation rather than marking
    that unverified text checked, including when it contains correct numbers.
    """
    if results:
        return '**Verified solution** (exact arithmetic):\n\n' + worked_answer(question, results, explain=True)
    if needs_label(question, results) and LABEL not in answer:
        answer += '\n\n' + LABEL
    return answer


def calculation_receipt(question, answer, results):
    """Bind the listed engine computations to the final published text.

    This is a record from the authenticated worker, not a signature or a check
    of instructor fit, whole assignments, source transcription or later edits.
    """
    if not results or not all(res['summary'] in answer for res in results):
        return None
    modulus = modulus_of(question)
    system = 'ordinary-exact' if modulus is None else 'prime-field' if isprime(modulus) else 'integer-ring'
    sha = lambda text: hashlib.sha256(text.encode('utf-8')).hexdigest()
    return {
        'schema': 1, 'kind': 'exact-calculation', 'scope': 'listed-calculations-only',
        'question_sha256': sha(question), 'answer_sha256': sha(answer.strip()),
        'computed_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'number_system': {'kind': system, 'modulus': modulus},
        'engine': {'name': 'sympy', 'version': SYMPY_VERSION,
                   'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        'calculations': [{'kind': res['kind'], 'summary': res['summary'], 'steps': list(res['steps'])} for res in results],
    }


EXPLAIN_RE = re.compile(r'\b(why|explain\w*|what does|meaning|interpret\w*|intuition|concept\w*|understand|prove|show that|'
                        r'justify|compare|difference|how do i|how to)\b', re.I)


def row_scaling_explanation(question):
    """A reversible-operation explanation backed by an exact counterexample."""
    if not re.search(r'\b(?:row|equation)s?\b',question,re.I) or not re.search(r'\b(?:multiply|multiplying|scal(?:e|ing|ar))\b',question,re.I) or not re.search(r'\b(?:non[ -]?zero|zero)\b',question,re.I):return None
    if not re.search(r'\b(?:why|explain|reason)\b',question,re.I) or re.search(r'=|\b(?:solve|compute|calculate)\b',question,re.I):return None
    x=Symbol('x',real=True)
    assert list(linsolve([2*x-6],(x,)))==[(Rational(3),)] and simplify(0*(2*x-6))==0
    text=('AI-written study explanation. Multiplying a row by a nonzero scalar $k$ can be undone by multiplying by $1/k$. That reversibility preserves exactly the same solutions. Multiplication by zero has no inverse and can discard a constraint.\n\n'
          'For a checked illustrative example, $2x=6$ requires $x=3$. Multiplying both sides by zero gives $0=0$, which every value of $x$ satisfies. The equality has not become false; the information that restricted $x$ has been lost.\n\n'
          'In a larger system, a zero row just says $0=0$. Other rows still determine whether there are no solutions, one solution or infinitely many. A redundant row can even be removed without changing the solutions, so zeroing a row does not always enlarge the solution set; it simply fails to guarantee equivalence.\n\n'
          'This is a general mathematical explanation, not a claim about a particular assignment. The numerical illustration was checked with exact arithmetic.')
    return {'text':text,'checks':[_result('check','The exact counterexample has x=3 before scaling; zero scaling produces the identity 0=0.',[Rational(3)])]}


def improper_log_integral_explanation(question):
    """Exact endpoint reasoning for one explicitly parsed real integral.

    This bounded natural-language form does not parse arbitrary prose as code,
    infer an expression from an image, or claim to handle other integrands.
    """
    pattern=r'\bintegral\s+from\s+1\s+to\s+e\s+of\s+dx\s+(?:divided\s+by|over)\s+x\s*sqrt\s*\(\s*1\s*-\s*\(\s*ln\s*x\s*\)\s*\^\s*2\s*\)'
    if len(re.findall(pattern,question,re.I))!=1 or not EXPLAIN_RE.search(question):return None
    if re.search(r'\b(?:twice|double|triple|half|sum|subtract|plus|minus|times|squared|different integral)\b|(?<!\w)[2-9]\s*dx',question,re.I):return None
    x=Symbol('x',positive=True);w=Symbol('w',real=True);b=Symbol('b',positive=True)
    integrand=1/(x*sqrt(1-log(x)**2));primitive=asin(log(x))
    assert simplify(diff(primitive,x)-integrand)==0
    assert simplify(diff(asin(w),w)-1/sqrt(1-w*w))==0
    value=limit(asin(b)-asin(0),b,1,dir='-')
    # Keep the positive real branch explicit on 0 <= w < 1. The cached
    # SymPy 1.14 limit routine returns a wrong negative infinity for the
    # unfactored quadratic root; do not accept that result as verification.
    positive_form=1/(sqrt(1-w)*sqrt(1+w))
    assert simplify(positive_form**2-1/(1-w*w))==0
    assert value==pi/2 and limit(positive_form,w,1,dir='-')==oo and limit(1/x,x,E,dir='-')==1/E
    summary=r'Checked one-sided limit: $\lim_{b\to1^-}(\arcsin b-\arcsin0)=\pi/2$.'
    text=("AI-written study explanation, checked with exact mathematics. The integrand becomes unbounded at the upper endpoint, but its accumulated area can still approach a finite value. This is a convergent improper integral, not a removable singularity.\n\n"
      r"Use $w=\ln x$, so $dw=dx/x$. The lower bound becomes $0$, and the upper endpoint is approached as $w\to1^-$. Work with a cutoff $b<1$ first:"+'\n\n'
      +r"$$I=\lim_{b\to1^-}\int_0^b\frac{dw}{\sqrt{1-w^2}}=\lim_{b\to1^-}(\arcsin b-\arcsin0)=\frac{\pi}{2}.$$"+'\n\n'
      +"The antiderivative approaches a finite value even though its derivative grows without bound. Plugging the endpoint into the integrand would be undefined; taking the limit of the integral is the step that justifies the finite result.\n\n"
      +summary+'\n\n'
      +"The engine checked the antiderivative by differentiation, the one-sided limit and the unbounded integrand. This verifies the typed expression above, not an original image or a student's transcription.\n\n"
      +"Next, write the cutoff and limit explicitly whenever you explain this example; do not replace that justification with direct substitution into the undefined integrand.")
    return {'text':text,'checks':[_result('check',summary,[value],steps=['Verified the antiderivative by exact differentiation.','Computed the left-hand antiderivative limit at w=1.','On 0 <= w < 1, checked the positive factored root, its infinite left-hand limit, and the finite positive factor 1/x at x=e.'])]}


def instant_answer(question, results):
    """The full verified answer for a pure computation, or None when the question needs the model.

    User decision 2026-10-01: computations the engine solves answer instantly from it; the model
    is used only when the question asks for an explanation.
    """
    count_request=re.search(r'\b(?:how many|number of) solutions?\b|\b(?:why|explain|show)\b.{0,70}\b(?:unique|solution count)\b',question,re.I)
    system=find_system(question) if count_request and re.search(r'\bsolve\b',question,re.I) else None
    if system and len(results)==1 and results[0]['kind']=='system' and not system[1].free_symbols:
        names,augmented=system;modulus=modulus_of(question)
        coefficient_rank=matrix_rank(augmented[:,:-1],modulus);augmented_rank=matrix_rank(augmented,modulus);n=len(names)
        if coefficient_rank<augmented_rank:
            why='The augmented rank exceeds the coefficient rank, so the reduced system contains a contradiction. There are no solutions.'
        elif coefficient_rank==n:
            why='The ranks agree and equal the number of variables. Every variable column has a pivot, with no free variables or contradiction, so the solution is unique.'
        elif modulus:
            why='The ranks agree, with %d free variable(s). Over the stated field there are exactly %d solutions.'%(n-coefficient_rank,modulus**(n-coefficient_rank))
        else:
            why='The ranks agree, with %d free variable(s), so the consistent real system has infinitely many solutions.'%(n-coefficient_rank)
        return worked_answer(question,results,explain=True)+'\n\nWhy this solution count is justified: coefficient rank %d, augmented rank %d, %d variables. '%(coefficient_rank,augmented_rank,n)+why
    if not results or EXPLAIN_RE.search(question) and not re.search(r'row[ -]*reduc|row operation',question,re.I):
        return None
    return worked_answer(question, results)


def worked_answer(question, results, explain=False):
    """Exact results, reproducible operations and a bounded mathematical method."""
    parts = []
    modulus = modulus_of(question)
    if modulus:
        parts.append('Arithmetic is modulo %d; residues are represented from 0 to %d.' % (modulus, modulus - 1))
    if explain:
        parts.extend(res['summary'] for res in results)
    methods = {
        'det': 'For a square matrix over the rationals, a nonzero determinant gives an inverse and a zero determinant means it is singular. Over a prime field a nonzero determinant is invertible; over a composite modulus it must be coprime to that modulus.',
        'inverse': 'An inverse undoes the original matrix transformation. Its product with the original must be the identity; the displayed inverse is checked by that multiplication.',
        'rref': 'Row swaps, nonzero row scalings and adding multiples of other rows preserve the row-equivalent system. Create each pivot and remove the other entries in its column.',
        'system': 'Reduce the augmented matrix using reversible row operations. A pivot in the right-hand-side column gives a contradiction. Otherwise pivot variables are determined by the free variables.',
        'rank': 'The rank is the number of pivots after row reduction, computed in the stated number system.',
        'eigen': 'Eigenvalues are roots of the characteristic equation: subtract the scalar times the identity from the matrix and set its determinant to zero.',
        'nullspace': 'Solve the homogeneous system with a zero right-hand side. Each free variable supplies a basis direction; linear combinations describe the null space.',
        'transpose': 'Exchange row and column positions, retaining each entry at the corresponding reversed position.',
        'product': 'Each product entry is the dot product of the corresponding left-matrix row and right-matrix column; the inner dimensions must agree.',
        'parameters': 'Compare the ranks of the coefficient and augmented matrices, using minors to determine parameter conditions. In row-echelon form, a row $[0 \\; \\cdots \\; 0 \\mid b]$ with $b \\ne 0$ means $0=b$: a contradiction and no solution. Equal ranks give consistency; both ranks must equal the number of variables for uniqueness.',
        'check': 'Check the stated vector against the original equations or homogeneous solution space rather than relying on whether expected numbers appear.',
        'setup': 'Substitute each given point into the requested polynomial to obtain an equation in its coefficients.',
        'consistency': 'Compare coefficient and augmented ranks for each identified system. Equal ranks give consistency; rank equal to the number of variables gives uniqueness.',
        'pivots': 'Read pivot positions from the reduced matrix. Coefficient columns without pivots identify free variables; the right-hand-side column is not a variable.',
    }
    seen = set()
    if explain:
        for res in results:
            if res['kind'] in methods and res['kind'] not in seen:
                parts.append('Method: ' + methods[res['kind']]); seen.add(res['kind'])
    mats = find_matrices(question)
    if explain and mats and mats[0].shape == (2, 2) and any(res['kind'] == 'det' for res in results):
        a = mats[0]; value = a.det() % modulus if modulus else a.det()
        parts.append('For the given matrix, $\\det(A) = (%s)(%s) - (%s)(%s) %s %s%s$.' % (_tex(a[0,0]), _tex(a[1,1]), _tex(a[0,1]), _tex(a[1,0]), '\\equiv' if modulus else '=', _tex(value), ' \\pmod{%d}' % modulus if modulus else ''))
    show_matrices=bool(re.search(r'intermediate matr|each row operation|showing each row operation',question,re.I))
    originals=mats if show_matrices else []
    for res in results:
        if res['steps']:
            parts.append('Row operations: ' + ', '.join(res['steps']))
            if originals:
                # Reapply each recorded exact operation and show the resulting
                # matrix. This teaches the method without asking a model to
                # invent unverified intermediate arithmetic.
                a=originals[0].applyfunc(lambda v:int(v)%modulus) if modulus else originals[0].copy();shown=['Initial matrix: $'+_tex(a)+'$']
                for step in res['steps']:
                    swap=re.fullmatch(r'\$R_\{(\d+)\} \\leftrightarrow R_\{(\d+)\}\$',step)
                    scale=re.fullmatch(r'\$R_\{(\d+)\} \\leftarrow (.+) R_\{\d+\}\$',step)
                    add=re.fullmatch(r'\$R_\{(\d+)\} \\leftarrow R_\{\d+\} ([+-]) (.*?)R_\{(\d+)\}\$',step)
                    def fraction(value):
                        value=value.replace(' ','')
                        match=re.fullmatch(r'(-?)\\frac\{(\d+)\}\{(\d+)\}',value)
                        return Rational(('-' if match.group(1) else '')+match.group(2)+'/'+match.group(3)) if match else Rational(value or '1')
                    if swap:a.row_swap(int(swap.group(1))-1,int(swap.group(2))-1)
                    elif add:
                        i,sign,coef,j=add.groups();i=int(i)-1;j=int(j)-1;a[i,:]=a[i,:]+(1 if sign=='+' else -1)*fraction(coef)*a[j,:]
                    elif scale:
                        i=int(scale.group(1))-1;a[i,:]=fraction(scale.group(2))*a[i,:]
                    else:raise ValueError('Unrecognized exact row operation')
                    if modulus: a=a.applyfunc(lambda v:int(v)%modulus)
                    shown.append(step+'\n\n$'+_tex(a)+'$')
                assert a==(rref_steps(originals[0],modulus)[0] if modulus else originals[0].rref()[0])
                parts.append('\n\n'.join(shown))
        if not explain: parts.append(res['summary'])
    parts.append('\u2713 Computed with exact arithmetic.')
    parts.append(LABEL)
    return '\n\n'.join(parts)
