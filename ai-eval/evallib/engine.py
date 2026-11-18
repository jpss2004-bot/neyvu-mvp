"""Exact linear-algebra engine used to build and grade the private test bank.

Everything here is exact (SymPy rationals). No floating point, no model, no network.
Python 3.9 compatible so the same code can run on the Mac mini's /usr/bin/python3.
"""
from sympy import Matrix, Rational, S, sympify
from sympy.matrices import MatrixBase


def to_matrix(rows):
    """Build an exact matrix from rows of ints, strings ("1/2"), SymPy numbers, or a Matrix."""
    if isinstance(rows, MatrixBase):
        return Matrix(rows)
    return Matrix([[sympify(value) for value in row] for row in rows])


def as_strings(values):
    return [str(sympify(v)) for v in values]


def classify(aug_rows):
    """Return 'unique', 'none' or 'infinite' for an augmented matrix [A | b]."""
    aug = to_matrix(aug_rows)
    n = aug.cols - 1
    coefficient_rank = aug[:, :n].rank()
    augmented_rank = aug.rank()
    if augmented_rank > coefficient_rank:
        return 'none'
    return 'unique' if coefficient_rank == n else 'infinite'


def solve_augmented(aug_rows):
    """Solve [A | b] exactly.

    Returns classification, the RREF, pivot columns (1-based), free columns (1-based),
    a particular solution (free variables set to 0) and one direction vector per free
    variable (that free variable 1, the others 0) for the homogeneous system.
    """
    aug = to_matrix(aug_rows)
    n = aug.cols - 1
    rref, pivots = aug.rref()
    result = {'classification': classify(aug_rows), 'rref': [[str(x) for x in rref.row(i)] for i in range(rref.rows)],
              'pivot_columns': [p + 1 for p in pivots if p < n], 'free_columns': [], 'particular': None, 'directions': []}
    if n in pivots:
        return result
    free = [j for j in range(n) if j not in pivots]
    result['free_columns'] = [j + 1 for j in free]
    particular = [S.Zero] * n
    for row, column in enumerate([p for p in pivots if p < n]):
        particular[column] = rref[row, n]
    result['particular'] = [str(x) for x in particular]
    for f in free:
        direction = [S.Zero] * n
        direction[f] = S.One
        for row, column in enumerate([p for p in pivots if p < n]):
            direction[column] = -rref[row, f]
        result['directions'].append([str(x) for x in direction])
    return result


def is_solution(aug_rows, point):
    aug = to_matrix(aug_rows)
    n = aug.cols - 1
    x = Matrix([sympify(v) for v in point])
    if x.rows != n:
        return False
    return (aug[:, :n] * x - aug[:, n]).is_zero_matrix


def column_space_contains(directions, vector):
    """True when vector lies in the span of the given direction vectors (exact)."""
    v = Matrix([sympify(x) for x in vector])
    if not directions:
        return v.is_zero_matrix
    D = Matrix([[sympify(x) for x in d] for d in directions]).T
    return D.rank() == D.row_join(v).rank()


def same_span(directions_a, directions_b):
    if not directions_a or not directions_b:
        return not directions_a and not directions_b
    A = Matrix([[sympify(x) for x in d] for d in directions_a]).T
    B = Matrix([[sympify(x) for x in d] for d in directions_b]).T
    r = A.rank()
    return r == B.rank() == A.row_join(B).rank()


def same_affine_set(particular_a, directions_a, particular_b, directions_b):
    """Two parametric solution families describe the same set of solutions."""
    if len(particular_a) != len(particular_b):
        return False
    difference = [sympify(a) - sympify(b) for a, b in zip(particular_a, particular_b)]
    return column_space_contains(directions_b, difference) and same_span(directions_a, directions_b)


def nullspace_basis(rows):
    return [[str(x) for x in v] for v in to_matrix(rows).nullspace()]


def in_nullspace(rows, vector):
    A = to_matrix(rows)
    v = Matrix([sympify(x) for x in vector])
    return v.rows == A.cols and (A * v).is_zero_matrix


def independent(vectors):
    if not vectors:
        return True
    M = Matrix([[sympify(x) for x in v] for v in vectors])
    return M.rank() == len(vectors)


def rref(rows):
    matrix, pivots = to_matrix(rows).rref()
    return [[str(x) for x in matrix.row(i)] for i in range(matrix.rows)], [p + 1 for p in pivots]


def row_equivalent(rows_a, rows_b):
    """Same shape and same RREF: B can be reached from A by elementary row operations."""
    A, B = to_matrix(rows_a), to_matrix(rows_b)
    return A.shape == B.shape and A.rref()[0] == B.rref()[0]


def pivot_positions(echelon_rows):
    """1-based (row, column) of the leading nonzero entry of each nonzero row."""
    M = to_matrix(echelon_rows)
    positions = []
    for i in range(M.rows):
        for j in range(M.cols):
            if M[i, j] != 0:
                positions.append((i + 1, j + 1))
                break
    return positions


def _mod_inverse(value, p):
    value %= p
    for candidate in range(1, p):
        if (value * candidate) % p == 1:
            return candidate
    raise ValueError('not invertible mod %d' % p)


def rref_mod(rows, p):
    """Row reduce over the integers modulo a prime p. Entries must be integers."""
    M = [[int(sympify(x)) % p for x in row] for row in rows]
    m, n = len(M), len(M[0])
    pivots, r = [], 0
    for c in range(n):
        pivot = next((i for i in range(r, m) if M[i][c] % p), None)
        if pivot is None:
            continue
        M[r], M[pivot] = M[pivot], M[r]
        inv = _mod_inverse(M[r][c], p)
        M[r] = [(x * inv) % p for x in M[r]]
        for i in range(m):
            if i != r and M[i][c]:
                factor = M[i][c]
                M[i] = [(a - factor * b) % p for a, b in zip(M[i], M[r])]
        pivots.append(c)
        r += 1
        if r == m:
            break
    return M, pivots


def solve_mod(aug_rows, p):
    """Unique solution of [A | b] over Z_p, or None when not unique / inconsistent."""
    M, pivots = rref_mod(aug_rows, p)
    n = len(aug_rows[0]) - 1
    if n in pivots or len([c for c in pivots if c < n]) != n:
        return None
    solution = [0] * n
    for row, column in enumerate(pivots):
        solution[column] = M[row][n]
    return solution


def eval_mod(expression, p):
    return int(sympify(expression)) % p


def parameter_classes(template_rows, var, fixed=None):
    """Exact solution-count classes for one parameter.

    Rank can only change where some minor (a polynomial in the parameter) vanishes, so the
    classification at every root of every nonconstant minor plus one generic value decides
    the whole real line. Returns {class: ('eq', [values]) | ('ne', [values]) | ('none',) | ('any',)}.
    """
    from itertools import combinations
    from sympy import Symbol, solve as sympy_solve
    symbol = Symbol(var)
    fixed = {Symbol(k): sympify(v) for k, v in (fixed or {}).items()}
    M = Matrix([[sympify(x).subs(fixed) for x in row] for row in template_rows])
    critical = set()
    for size in range(1, min(M.shape) + 1):
        for rows in combinations(range(M.rows), size):
            for cols in combinations(range(M.cols), size):
                minor = M.extract(list(rows), list(cols)).det()
                if minor.has(symbol):
                    for root in sympy_solve(minor, symbol):
                        if root.is_real:
                            critical.add(root)
    generic = Rational(1000003, 7)
    while generic in critical:
        generic += 1
    at = {root: classify(M.subs(symbol, root)) for root in critical}
    generic_class = classify(M.subs(symbol, generic))
    result = {}
    for label in ('unique', 'none', 'infinite'):
        if generic_class == label:
            others = sorted((r for r, v in at.items() if v != label), key=lambda x: float(x))
            result[label] = ('ne', [str(r) for r in others]) if others else ('any',)
        else:
            hits = sorted((r for r, v in at.items() if v == label), key=lambda x: float(x))
            result[label] = ('eq', [str(r) for r in hits]) if hits else ('none',)
    return result


def classification_for_parameters(template_rows, assignment):
    """Classify an augmented matrix whose entries may contain symbols such as h or k."""
    substituted = [[sympify(x).subs({sympify(k): sympify(v) for k, v in assignment.items()}) for x in row]
                   for row in template_rows]
    return classify(substituted)


__all__ = [name for name in dir() if not name.startswith('_')]
