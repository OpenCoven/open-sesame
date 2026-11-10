"""Local NeMo speaker labels. Audio stays in an owned temporary PCM file, never uploads."""
import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

VERSION = '3.0.0'
MODEL = 'diar_streaming_sortformer_4spk-v2.1.nemo'
REVISION = 'cd03eee90fbec18297ac31b8c21546e596b7f71c'
DIGEST = '8abd32832159c6ac1148c926b7276f35ba34582c444e559dce1f1253fea42ef8'
URL = 'https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1/resolve/' + REVISION + '/' + MODEL
MAX_SAMPLES = 16000 * 1800


def root():
    return Path.home() / 'Library/Application Support/Open Sesame/diarization'


def install():
    folder = root(); folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime = folder / 'runtime'; python = runtime / 'bin/python3'
    if not python.is_file():
        candidates = [shutil.which('python3.12'), shutil.which('python3.13'), '/opt/homebrew/bin/python3.12', '/usr/local/bin/python3.12']
        base = next((p for p in candidates if p and Path(p).is_file()), None)
        if not base: raise ValueError('Install Python 3.12 or 3.13, then run speaker setup again.')
        subprocess.run([base, '-m', 'venv', str(runtime)], check=True)
    print('Installing the local NeMo runtime. No audio or credentials are uploaded.', flush=True)
    subprocess.run([str(python), '-m', 'pip', 'install', 'nemo_toolkit[asr]==' + VERSION, '-c', str(Path(__file__).with_name('diarization-constraints.txt'))], check=True)
    model = folder / MODEL
    if not model.is_file() or checksum(model) != DIGEST:
        pending = folder / ('download-' + str(os.getpid()) + '.tmp')
        print('Downloading the pinned 471 MB NVIDIA speaker model.', flush=True)
        try:
            with urllib.request.urlopen(URL, timeout=60) as response, pending.open('wb') as target:
                while chunk := response.read(1024 * 1024): target.write(chunk)
            if checksum(pending) != DIGEST: raise ValueError('The speaker model checksum did not match. Retry setup.')
            pending.replace(model)
        finally: pending.unlink(missing_ok=True)
    print('Speaker labels are ready. Return to Live and enable Speakers before Start.', flush=True)


def checksum(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        while chunk := stream.read(1024 * 1024): digest.update(chunk)
    return digest.hexdigest()


def segments(rows, duration):
    result = []
    if not isinstance(rows, list): raise ValueError('Invalid speaker output.')
    for row in rows:
        if not isinstance(row, str): raise ValueError('Invalid speaker output.')
        fields = row.split()
        if len(fields) != 3: raise ValueError('Invalid speaker output.')
        start, end = float(fields[0]), float(fields[1])
        speaker = fields[2].removeprefix('speaker_')
        if not speaker.isdigit() or not 0 <= int(speaker) < 4 or not 0 <= start < end <= duration + .25:
            raise ValueError('Invalid speaker interval.')
        result.append({'start': start, 'end': min(end, duration), 'speaker': int(speaker)})
        if len(result) > 20000: raise ValueError('Speaker output limit exceeded.')
    return result


def run(audio, model_path, stop_file):
    # Native owns these paths; the renderer cannot choose any filesystem path.
    if audio.is_symlink() or not audio.is_file() or stop_file.parent != audio.parent:
        raise ValueError('The audio session is unavailable.')
    if checksum(model_path) != DIGEST: raise ValueError('Run speaker setup again: the local model could not be verified.')
    protocol = sys.stdout
    def emit(value):
        protocol.write(json.dumps(value, allow_nan=False) + '\n'); protocol.flush()
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import torch
        from nemo.collections.asr.models import SortformerEncLabelModel
        if importlib.metadata.version('nemo_toolkit') != VERSION: raise ValueError('Run speaker setup again to use the supported NeMo version.')
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        model = SortformerEncLabelModel.restore_from(str(model_path), map_location='cpu'); model.eval()
    emit({'type': 'ready', 'model': 'NeMo Sortformer v2.1', 'maxSpeakers': 4})
    previous = 0; last_run = 0
    while True:
        complete = stop_file.exists()
        count = min(audio.stat().st_size // 4, MAX_SAMPLES)
        # One inference at a time, retaining all arrival-order context. Coalesce updates
        # under CPU load; never queue one expensive model call per microphone callback.
        if count > previous and count >= 16000 and (complete or time.monotonic() - last_run >= 8):
            with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
                waveform = np.fromfile(str(audio), dtype='<f4', count=count)
                predicted = model.diarize(audio=waveform, batch_size=1, sample_rate=16000)
            rows = segments(predicted[0], count / 16000)
            emit({'type': 'segments', 'segments': rows, 'through': count / 16000, 'final': complete})
            previous = count; last_run = time.monotonic()
        if complete:
            emit({'type': 'ended'}); return
        time.sleep(.15)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--install', action='store_true'); parser.add_argument('--audio'); parser.add_argument('--model'); parser.add_argument('--stop')
    args = parser.parse_args()
    try:
        if args.install: install()
        elif args.audio and args.model and args.stop: run(Path(args.audio), Path(args.model), Path(args.stop))
        else: raise ValueError('Choose speaker setup or a native audio session.')
    except (Exception, KeyboardInterrupt):
        if args.install: print('Speaker setup did not finish. Review the installation error above, then retry.', file=sys.stderr)
        else: print(json.dumps({'type': 'error', 'message': 'Speaker labels could not finish. Your transcript is preserved; run speaker setup or try again.'}), flush=True)
        raise SystemExit(1)
