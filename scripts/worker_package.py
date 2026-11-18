"""Identify the complete local Python import package without executing its code.

The extraction/math/speech CLIs are subprocess entry points. Optional Docling is not
part of an ordinary worker release; it requires separate configuration/proof.
"""
import ast
import hashlib
import re
from pathlib import Path

# Keep subprocess scripts explicit: AST import traversal cannot discover the
# Path(__file__).with_name(...) executable used by class_speech_worker.
ENTRY_POINTS = ('beta_ai_worker.py', 'extract_pdf.py', 'mathcheck_cli.py',
                'class_speech_section.py')
MODEL = 'qwen3:4b-instruct'
MODEL_DIGEST = '0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0'


def worker_files(folder, entry_points=ENTRY_POINTS):
    folder = Path(folder)
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('Use a real worker source directory')
    pending = list(entry_points)
    seen = set()
    while pending:
        name = pending.pop()
        if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.py', name):
            raise ValueError('Invalid worker module name')
        if name in seen:
            continue
        path = folder / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing or unsafe worker module: ' + name)
        seen.add(name)
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=name)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [item.name for item in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    raise ValueError('Relative worker imports require explicit package review')
                modules = [node.module] if node.module else []
            else:
                continue
            for module in modules:
                dependency = module.split('.')[0] + '.py'
                # Include guarded and function-local imports too: their code
                # can affect a release even when an optional feature is off.
                if (folder / dependency).exists() or (folder / dependency).is_symlink():
                    pending.append(dependency)
    return tuple(sorted(seen))


def worker_hashes(folder):
    folder = Path(folder)
    return {name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
            for name in worker_files(folder)}


def verify_attestation(value, expected):
    if value.get('model_digest') != MODEL_DIGEST:
        raise ValueError('The model does not match the qualified digest')
    if value.get('worker_hashes') != expected:
        raise ValueError('The staged worker package does not match all source hashes')
    return value
