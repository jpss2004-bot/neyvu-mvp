"""Exact general homogeneous-system explanations for the isolated local test.

This does not solve an assignment matrix or establish a course's terminology.
It answers only general concept requests, with an explicitly illustrative matrix.
The production worker and its guard modules do not import this module.
"""
from __future__ import annotations

from fractions import Fraction
import re
from typing import Any

try:
    import sympy as sp
except Exception:
    sp = None


class ExactConceptUnavailable(RuntimeError):
    """A supported concept answer could not be verified exactly."""


def _exact_number(value):
    if sp is None:
        raise ExactConceptUnavailable("Exact verification is unavailable for this explanation.")
    if type(value) is int:
        return sp.Integer(value)
    if isinstance(value, sp.Rational):
        return value
    if isinstance(value, str) and len(value) <= 48 and re.fullmatch(r"[+-]?\d+(?:/[+-]?\d+)?", value):
        number = Fraction(value)
        return sp.Rational(number.numerator, number.denominator)
    raise ValueError("The illustration requires exact rational matrix entries.")


def checked_nullspace(rows):
    """Certify canonical free-variable basis vectors using exact rational arithmetic."""
    if sp is None:
        raise ExactConceptUnavailable("Exact verification is unavailable for this explanation.")
    if (not isinstance(rows, (list, tuple)) or not rows or len(rows) > 12
            or not isinstance(rows[0], (list, tuple)) or not rows[0] or len(rows[0]) > 12
            or any(not isinstance(row, (list, tuple)) or len(row) != len(rows[0]) for row in rows)):
        raise ValueError("Choose a nonempty rectangular illustration up to 12 by 12.")
    matrix = sp.ImmutableMatrix([[_exact_number(value) for value in row] for row in rows])
    reduced, pivot_columns = matrix.rref()
    rank = matrix.rank()
    columns = matrix.cols
    free_columns = tuple(column for column in range(columns) if column not in pivot_columns)
    nullity = columns - rank
    if len(pivot_columns) != rank or len(free_columns) != nullity:
        raise ExactConceptUnavailable("Rank and free-variable verification disagreed.")
    basis = []
    for free_column in free_columns:
        vector = sp.zeros(columns, 1)
        vector[free_column] = 1
        for row, pivot_column in enumerate(pivot_columns):
            vector[pivot_column] = -reduced[row, free_column]
        if matrix * vector != sp.zeros(matrix.rows, 1):
            raise ExactConceptUnavailable("The illustrated basis failed exact substitution.")
        if any(vector[column] != (1 if column == free_column else 0) for column in free_columns):
            raise ExactConceptUnavailable("The illustrated free parameters failed verification.")
        basis.append(vector)
    if len(basis) != nullity or (basis and sp.Matrix.hstack(*basis).rank() != nullity):
        raise ExactConceptUnavailable("The illustrated vectors failed basis verification.")
    # An independently computed null-space basis must have the same span.
    independent = matrix.nullspace()
    if len(independent) != nullity or (basis and sp.Matrix.hstack(*(basis + independent)).rank() != nullity):
        raise ExactConceptUnavailable("Independent null-space verification disagreed.")
    encode_matrix = lambda m: [[str(m[row, column]) for column in range(m.cols)] for row in range(m.rows)]
    return {
        "matrix": encode_matrix(matrix),
        "rref": encode_matrix(reduced),
        "rank": int(rank),
        "columns": int(columns),
        "nullity": int(nullity),
        "pivot_columns": list(pivot_columns),
        "free_columns": list(free_columns),
        "basis": [[str(value) for value in vector] for vector in basis],
        "products": [[str(value) for value in matrix * vector] for vector in basis],
        "verified": True,
    }


def _strip_course_codes(text):
    return re.sub(r"\b(?:MATH|BUSI|COMM|PHIL)\s*\d{4}L?\b", "", text, flags=re.I)


def _mentions_specific_matrix(text):
    text = _strip_course_codes(text)
    return bool(re.search(
        r"\[\s*\[|\\begin\s*\{[bpvV]?matrix\}|\bA\s*=|"
        r"\b(?:this|given|following|above|below|my)\s+(?:homogeneous\s+)?(?:matrix|system)\b|"
        r"\b(?:matrix|system)\s+[A-Z]\b|\b(?:matrix|system)\b[^\n]{0,100}\d",
        text, re.I))


def supports_question(job: dict[str, Any]) -> bool:
    """Keep a generic illustration out of matrix-specific and assignment requests."""
    if job.get("mode") == "plan":
        return False
    question = job.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > 3000:
        return False
    # A course identifier supplies scope, not a matrix coefficient.
    text = _strip_course_codes(question)
    homogeneous = bool(re.search(r"\bhomogene?ous\b", text, re.I))
    nullspace = bool(re.search(r"\bnull[ -]?space\b", text, re.I))
    basis_topic = bool(re.search(r"\bbasic solutions?\b|\bbasis\b|\bfundamental solutions?\b|\bspecial solutions?\b|\bfree (?:variables?|parameters?)\b|\bnullity\b", text, re.I))
    if not ((homogeneous and basis_topic) or nullspace):
        return False
    if not re.search(r"\b(?:explain|define|describe|definition|concept|understand|why|what|how|does|do|is|are)\b", text, re.I):
        return False
    if re.search(r"\d|\b(?:assignment|homework|exercise|question|problem|quiz|test)\b|\b(?:solve|calculate|compute|evaluate|determine|row[ -]?reduce)\b", text, re.I):
        return False
    if re.search(r"\b(?:find|construct|obtain)\b", text, re.I) and not re.search(r"\b(?:how|explain|describe)\b", text, re.I):
        return False
    if _mentions_specific_matrix(text):
        return False
    history = job.get("history") or []
    for message in history if isinstance(history, list) else []:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        previous = message.get("text") or message.get("content") or ""
        if isinstance(previous, str) and _mentions_specific_matrix(previous):
            return False
    selected = job.get("context") or []
    selected_ids = {value for value in selected if isinstance(value, str)} if isinstance(selected, list) else set()
    for source in job.get("sources") or []:
        if not isinstance(source, dict) or source.get("id") not in selected_ids:
            continue
        content = str(source.get("excerpt") or source.get("body") or "")
        if _mentions_specific_matrix(content):
            return False
    return True


def answer_if_supported(job: dict[str, Any]):
    """Return the local worker result or None; matching requests fail closed."""
    if not supports_question(job):
        return None
    proof = checked_nullspace([[1, 2, 3], [0, 1, 4]])
    if (proof["rank"], proof["nullity"], proof["basis"], proof["products"]) != (2, 1, [["5", "-4", "1"]], [["0", "0"]]):
        raise ExactConceptUnavailable("The fixed illustration failed its expected exact checks.")
    text = r"""In a homogeneous system $A\mathbf{x}=\mathbf{0}$, basic solutions form a basis for the null space.

If $A$ has $n$ columns and rank $r$, it has $n-r$ free variables and $n-r$ basic solution vectors. To construct each vector, set one **free variable** to $1$, set the other free variables to $0$, and derive the pivot variables from the reduced equations. The resulting vector can have several nonzero coordinates. Every solution is a linear combination of these vectors.

**General illustration checked with exact arithmetic**

$$
A=\begin{bmatrix}1&2&3\\0&1&4\end{bmatrix},\qquad
\operatorname{rref}(A)=\begin{bmatrix}1&0&-5\\0&1&4\end{bmatrix}.
$$

There are three variables, rank $2$, and one free variable, $x_3$. The reduced equations give $x_1=5x_3$ and $x_2=-4x_3$. Setting $x_3=1$ gives the single basic solution

$$\mathbf{v}=\begin{bmatrix}5\\-4\\1\end{bmatrix}.$$

Exact substitution verifies

$$A\mathbf{v}=\begin{bmatrix}5-8+3\\-4+4\end{bmatrix}=\begin{bmatrix}0\\0\end{bmatrix}.$$

Thus every solution in this illustration is $\mathbf{x}=t\mathbf{v}$. For a matrix with full column rank, the only solution is the zero vector and the null-space basis is empty.

This is a general mathematical explanation with an illustrative matrix. Check your course source for its terminology."""
    return {"text": text, "model": "exact-concept-engine", "input_tokens": 0, "output_tokens": 0,
            "model_requests": 0, "concept_proof": proof}
