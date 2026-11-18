"""Offline, pinned speech primitive for class capture; no worker activation.

The caller owns job leases, checkpointing and private output storage. This CLI
does not import personal-pilot adapters or fetch models. Long-class scheduling
must be qualified before connecting it to the online beta.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import socket
import sys

MODEL_FILES = ('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt')
MAX_BYTES = 128 * 1024 * 1024
MAX_SECONDS = 7200
END_TOLERANCE_MS = 1000


def sha256(file):
    value = hashlib.sha256()
    with file.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def pinned_model(folder, manifest):
    folder = Path(folder)
    if not folder.is_absolute() or not folder.is_dir():
        raise ValueError('Use an existing absolute local model directory.')
    if (manifest.get('version') != 1 or manifest.get('engine') != 'faster-whisper'
            or set(manifest.get('files', {})) != set(MODEL_FILES)):
        raise ValueError('Invalid pinned speech model manifest.')
    for name in MODEL_FILES:
        expected = manifest['files'][name]
        if not isinstance(expected, str) or len(expected) != 64 or sha256(folder / name) != expected:
            raise ValueError('The local speech model does not match its pinned manifest.')
    return folder


def deny_network(*args, **kwargs):
    raise RuntimeError('Class transcription is offline; network access is disabled.')


def decode_bounded(audio, max_seconds=MAX_SECONDS):
    import av
    import numpy as np
    resampler = av.audio.resampler.AudioResampler(format='s16', layout='mono', rate=16000)
    pcm = bytearray()
    # Use bounded local file IO and disallow libav network/file references from
    # crafted containers as well as the Python-level network calls below.
    with Path(audio).open('rb') as source, av.open(source, mode='r', options={
            'protocol_whitelist': 'pipe', 'enable_drefs': '0', 'use_absolute_path': '0'}) as container:
        for frame in container.decode(audio=0):
            frame.pts = None
            for decoded in resampler.resample(frame):
                data = decoded.to_ndarray().tobytes()
                if len(pcm) + len(data) > max_seconds * 16000 * 2:
                    raise ValueError('Decoded audio exceeds the two-hour recording limit.')
                pcm.extend(data)
        for decoded in resampler.resample(None):
            data = decoded.to_ndarray().tobytes()
            if len(pcm) + len(data) > max_seconds * 16000 * 2:
                raise ValueError('Decoded audio exceeds the two-hour recording limit.')
            pcm.extend(data)
    if not pcm:
        raise ValueError('The recording contains no decoded audio.')
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(audio, model_folder, manifest):
    audio = Path(audio)
    if not audio.is_absolute() or audio.is_symlink() or not audio.is_file() or not 0 < audio.stat().st_size <= MAX_BYTES:
        raise ValueError('Use a private local audio file up to 128 MB.')
    folder = pinned_model(model_folder, manifest)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.getaddrinfo = deny_network
    from faster_whisper import WhisperModel
    # The absolute directory and local_files_only prevent model-name resolution.
    decoded = decode_bounded(audio)
    model = WhisperModel(str(folder), device='cpu', compute_type='int8', cpu_threads=4,
                         local_files_only=True)
    speech, info = model.transcribe(decoded, beam_size=3, vad_filter=True)
    if not math.isfinite(info.duration) or not 0 < info.duration <= MAX_SECONDS:
        raise ValueError('The audio must contain at most two hours of decoded audio.')
    duration_ms = math.ceil(info.duration * 1000)
    segments = []
    characters = 0
    for item in speech:
        start, end = round(item.start * 1000), round(item.end * 1000)
        # Whisper timestamps are coarse tokens; the final segment can end a little
        # past the decoded audio (observed: 25700 ms on a 25510 ms clip). Clamp a
        # small overshoot and flag it for review instead of discarding the transcript.
        clamped = start <= duration_ms < end <= duration_ms + END_TOLERANCE_MS
        if clamped:
            end = duration_ms
        content = item.text.strip()
        characters += len(content)
        if (len(segments) >= 5000 or characters > 240000 or len(content) > 10000
                or start < 0 or end < start or end > duration_ms
                or (segments and start < segments[-1]['start_ms'])):
            raise ValueError('Speech output exceeded the recording bounds; no transcript was emitted.')
        # These signals flag review; they do not measure proven word accuracy.
        uncertain = (clamped or not math.isfinite(item.avg_logprob) or not math.isfinite(item.no_speech_prob)
                     or item.avg_logprob < -1 or item.no_speech_prob > 0.6)
        segments.append({'start_ms': start, 'end_ms': end, 'text': content,
                         'uncertain': uncertain, 'speaker': 'unidentified'})
    return {'version': 1, 'audio_sha256': sha256(audio), 'duration_ms': duration_ms, 'language': info.language,
            'segments': segments,
            'runtime': {'engine': 'faster-whisper',
                        'version': importlib.metadata.version('faster-whisper'),
                        'model_sha256': manifest['files']['model.bin']},
            'limitations': ['Speakers are unidentified.',
                            'Review mathematical notation and uncertain speech against the recording.',
                            'Only audible speech is transcribed; unseen board work and diagrams are missing.']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--model-directory', required=True)
    parser.add_argument('--model-manifest', required=True)
    args = parser.parse_args()
    with open(args.model_manifest, encoding='utf-8') as source:
        manifest = json.load(source)
    try:
        result = transcribe(args.audio, args.model_directory, manifest)
    except Exception:
        # Keep private paths/content out of operator-visible error messages.
        print('Local transcription failed. Preserve the audio and check the private runtime and model manifest.', file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
