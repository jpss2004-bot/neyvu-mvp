"""Read-only, minimal projection of the active worker; never collects or writes."""
import json
import sys
from pathlib import Path


def project(snapshot, academic, plan, source_tasks=()):
    task_keys = ('id', 'source_id', 'title', 'course', 'official_url', 'preparation', 'due', 'do_on',
                 'label', 'submission', 'receipt_checked', 'receipt_fresh', 'grade',
                 'grade_checked', 'grade_fresh', 'needs_attention', 'conflict',
                 'next_action', 'working_status', 'confirmed_submitted')
    card_keys = ('id', 'title', 'course', 'action', 'why', 'done_when', 'due', 'url')
    health_keys = ('id', 'name', 'status', 'last_complete_observation', 'last_observation', 'scope')
    delivery_keys = ('id', 'kind', 'status', 'provider', 'accepted_at', 'attempts')
    knowledge = snapshot.get('knowledge_status', {})
    # Receipt echoes and email claims are not additional assignments. Normalize
    # UUID formatting only; distinct personal tasks sharing a link remain distinct.
    tasks = {}
    source_by_id = {str(t['id']).replace('-', ''): t for t in source_tasks}
    for row in academic['items']:
        if row.get('source_id') not in {'notion', 'moodle'}:
            continue
        key = (row.get('source_id'), str(row['id']).replace('-', '') if row.get('source_id') == 'notion' else row['id'])
        item = {k: row.get(k) for k in task_keys}
        original = source_by_id.get(str(row['id']).replace('-', ''), {})
        item['planned_due'] = original.get('notion_due')
        item['source_observed_at'] = original.get('official_observed_at') or original.get('observed_at')
        item['due_authority'] = original.get('due_authority') or original.get('authority') or 'Unverified'
        tasks[key] = item
    valid_ids = {str(t['id']).replace('-', '') for t in tasks.values()}
    focus = []
    seen = set()
    for row in plan.get('recommendations', []) + plan.get('additional_focus', []):
        key = str(row['id']).replace('-', '')
        if key in valid_ids and key not in seen:
            focus.append({k: row.get(k) for k in card_keys})
            seen.add(key)
    return {
        'generatedAt': snapshot.get('generated_at'),
        'heartbeat': snapshot.get('coordinator_last_tick'),
        'tasks': list(tasks.values()),
        'focus': focus[:3],
        'health': [{k: row.get(k) for k in health_keys} for row in snapshot['health']
                   if row['id'] in {'moodle', 'notion', 'notion_notes', 'gmail'}],
        'delivery': [{k: row.get(k) for k in delivery_keys} for row in snapshot.get('delivery', [])],
        'operations': [{k: row.get(k) for k in ('name', 'status', 'last_success_at', 'checked_at')}
                       for row in snapshot.get('operation_health', [])],
        'vault': {k: knowledge.get(k) for k in ('built_at', 'documents', 'chunks', 'edges')},
    }


if __name__ == '__main__':
    sys.path.insert(0, sys.argv[1])
    from academic_status import report
    from planner import build_plan
    from core import tasks_from
    snapshot = json.loads(Path(sys.argv[2]).read_text())
    print(json.dumps(project(snapshot, report(snapshot), build_plan(snapshot, 'today'), tasks_from(snapshot))))
