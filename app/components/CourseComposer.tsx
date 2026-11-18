'use client';

// Adapted from Kokonut UI's MIT AI Input Search and auto-resize hook.
// Copyright (c) 2025 kokonutUI. License: /public/licenses/kokonut-ui.txt.
// Source and modifications: /docs/21st component research 2026-09-30.md.
import {useEffect, useRef} from 'react';
import {ArrowUp, BookOpen, ChevronDown, LoaderCircle, NotebookPen} from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  course: string;
  courses: {code: string}[];
  onCourseChange: (course: string) => void;
  onSubmit: () => void;
  onOpenNotes: () => void;
};

export default function CourseComposer({value, onChange, busy, course, courses, onCourseChange, onSubmit, onOpenNotes}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Native content sizing avoids measuring layout on every keystroke.
    if (CSS.supports('field-sizing', 'content')) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    let frame = 0;
    let width = textarea.clientWidth;
    function resize() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!textarea) return;
        textarea.style.height = '54px';
        textarea.style.height = `${Math.max(54, Math.min(textarea.scrollHeight, 176))}px`;
      });
    }
    resize();
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next !== width) { width = next; resize(); }
    });
    observer.observe(textarea);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);

  function submit() { if (!busy && value.trim()) onSubmit(); }

  return <form className="chat-composer course-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
    <label className="sr-only" htmlFor="question">Ask your course assistant</label>
    <textarea ref={textareaRef} id="question" name="question" autoComplete="off"
      placeholder="Ask about your courses, notes, or next step…" rows={2}
      value={value} maxLength={3000} onChange={event => onChange(event.target.value)}
      aria-describedby="composer-help"
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault(); submit();
        }
      }}/>
    <div className="composer-bottom">
      <div className="composer-tools">
        <label className="scope-select"><BookOpen size={14} aria-hidden="true"/>
          <select name="course" aria-label="Course context" value={course} disabled={busy}
            onChange={event => onCourseChange(event.target.value)}>
            <option value="">All courses</option>{courses.map(item => <option key={item.code}>{item.code}</option>)}
          </select><ChevronDown size={12} aria-hidden="true"/>
        </label>
        <button type="button" className="composer-notes" onClick={onOpenNotes}
          aria-label={course ? `Open ${course} notebook` : 'Open class notes'} title="Open class notes">
          <NotebookPen size={17} aria-hidden="true"/>
        </button>
      </div>
      <button type="submit" className="send-button" disabled={busy || !value.trim()}
        aria-label={busy ? 'Answer in progress' : 'Send question'}>
        {busy ? <LoaderCircle className="composer-spinner" size={19} aria-hidden="true"/> : <ArrowUp size={20} aria-hidden="true"/>}
      </button>
    </div>
    <p id="composer-help" className="composer-footnote">Check official dates in Moodle.
      {value.length >= 2700 ? <span>{3000 - value.length} characters left</span> : null}
    </p>
  </form>;
}
