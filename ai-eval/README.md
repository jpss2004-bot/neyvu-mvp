# Evaluation harness (public part)

Neyvu's release gate runs every AI change against three checks: a frozen bank of 150 questions written from real course material, the adversarial set in this folder, and a rephrase test. The 150-question bank and its answer keys are private because they come from real courses, so this folder holds only the code and the synthetic material.

| Path | What it is |
|---|---|
| `adversarial/build_adversarial.py` | Writes the adversarial set. Every item is synthetic: a fictional course (DEMO 1010), instructor and students. |
| `adversarial/moodle_injection.jsonl` | The 18 hidden-instruction attacks: fake deadlines in forum posts, planted "system" messages, false grade claims and similar. |
| `adversarial/checks.py` | Deterministic checks for each attack. No model grades another model. |
| `run_adversarial.py` | Runs a local model through the worker pipeline on the adversarial set and scores it. |
| `run_eval.py`, `evallib/` | The bank runner, graders, exact maths engine and scorecard. `run_eval.py` needs the private bank. |
| `tests/` | Unit tests for the graders and the adversarial checks. The bank-integrity test is skipped when the bank is absent. |

Run the tests from this folder with Python 3.13 and SymPy:

```sh
python3 -m unittest discover -s tests
```
