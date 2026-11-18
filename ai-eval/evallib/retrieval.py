"""Retrieval exactly as the pilot app forms its evidence context today, read-only.

The vault's own ranking function (Sync/operations/knowledge.py search) is imported with
bytecode writing disabled, so nothing is written into the vault. The knowledge index and
the source register are only read.
"""
import csv
import hashlib
import json
import os
import sys
from pathlib import Path

DEFAULT_VAULT = Path(os.environ.get('SCHOOL_VAULT', str(Path.home() / 'school-vault')))
DEFAULT_INDEX = Path(os.environ.get('SCHOOL_KNOWLEDGE_INDEX', str(Path.home() / '.schoolvault/state/knowledge_index.json')))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def load_search(vault):
    """Import knowledge.search from the vault without writing __pycache__ there."""
    operations = Path(vault) / 'Sync/operations'
    if not (operations / 'knowledge.py').is_file():
        raise SystemExit('knowledge.py not found under %s (pass --vault)' % operations)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(operations))
    try:
        import knowledge  # noqa: E402  (vault module, read-only use)
    finally:
        sys.path.remove(str(operations))
        sys.dont_write_bytecode = previous
    return knowledge.search, sha256_file(operations / 'knowledge.py')


def load_register(vault):
    """Map vault-relative paths to the registered title/url, like pilot_bridge.catalog()."""
    register = {}
    path = Path(vault) / 'Sync/course_source_register.csv'
    if not path.is_file():
        return register
    root = Path(vault).resolve()
    with open(path, newline='') as handle:
        for row in csv.DictReader(handle):
            ident = hashlib.sha256((row['course'] + row['source_url'] + row['local_path']).encode()).hexdigest()[:24]
            local = row.get('local_path') or ''
            candidate = (root / local).resolve() if local else None
            captured = bool(candidate and root in candidate.parents and candidate.is_file())
            if local:
                register.setdefault(local, {'id': ident, 'title': row['title'], 'url': row['source_url'], 'captured': captured})
    return register


class Retriever:
    def __init__(self, vault=DEFAULT_VAULT, index_path=DEFAULT_INDEX, limit=6):
        self.vault, self.index_path, self.limit = Path(vault), Path(index_path), limit
        self.search, self.knowledge_sha = load_search(self.vault)
        with open(self.index_path) as handle:
            self.index = json.load(handle)
        self.index_sha = sha256_file(self.index_path)
        self.register = load_register(self.vault)
        self.paths = set()
        for document in self.index['documents']:
            self.paths.add(document['path'])
            self.paths.update(document.get('aliases', []))

    def __call__(self, query, course=None):
        return self.search(self.index, query, course=course or None, limit=self.limit)

    def indexed(self, path):
        return path in self.paths

    def describe(self):
        return {'method': 'vault knowledge.search (TF-IDF cosine + assessment identity + explicit links), top-%d' % self.limit,
                'index_path': str(self.index_path), 'index_built_at': self.index.get('built_at'), 'index_sha256': self.index_sha,
                'documents': len(self.index['documents']), 'chunks': len(self.index['chunks']),
                'knowledge_py_sha256': self.knowledge_sha, 'register_entries': len(self.register)}
