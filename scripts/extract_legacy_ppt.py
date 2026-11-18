"""Opt-in legacy-slide reader for capability-negotiated app extraction jobs.

Requires the already installed macOS LibreOffice and sandbox-exec. No installer,
network fallback, macro execution or edits to the input. JSON retains both hashes.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from extract_pdf import MAX_INPUT, extract_office

OLE = bytes.fromhex('d0cf11e0a1b11ae1')
OFFICE = Path('/Applications/LibreOffice.app/Contents/MacOS/soffice')
SANDBOX = Path('/usr/bin/sandbox-exec')
# LibreOffice uses Unix-domain IPC during bootstrap. IP networking stays denied.
def sandbox_policy(folder):
    # Permit installed application/system resources and this one conversion only.
    # Metadata probes may discover a path, but cannot read its data or alter it.
    read_only=['/Applications/LibreOffice.app','/System/Library','/System/Volumes/Preboot/Cryptexes','/usr/lib','/usr/share','/Library/Fonts']
    rules=['(version 1)','(allow default)','(deny network*)',
           '(allow network* (local unix-socket))','(deny file-read-data file-write*)',
           '(allow file-read-data file-write* (subpath '+json.dumps(str(folder))+'))']
    rules += ['(allow file-read-data (subpath '+json.dumps(p)+'))' for p in read_only]
    rules += ['(allow file-read-data (literal '+json.dumps(p)+'))' for p in
              ['/','/dev/null','/dev/urandom','/dev/random','/private/etc/localtime','/private/etc/hosts']]
    rules.append('(allow file-write* (literal "/dev/null"))')
    return '\n'.join(rules)
PROFILE = '''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting">
<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
</item></oor:items>'''


def ready():
    return os.environ.get('SCHOOL_LEGACY_PPT_READER') == '1' and sys.platform == 'darwin' and OFFICE.is_file() and SANDBOX.is_file()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def convert(data, *, timeout=30):
    if not data.startswith(OLE) or not 512 <= len(data) <= MAX_INPUT:
        raise ValueError('Invalid or oversized legacy PowerPoint input')
    if sys.platform != 'darwin' or not OFFICE.is_file() or not SANDBOX.is_file():
        raise ValueError('Isolated legacy PowerPoint conversion is unavailable on this host')
    if not 1 <= timeout <= 30:
        raise ValueError('Invalid conversion timeout')
    with tempfile.TemporaryDirectory(prefix='neyvu-ppt-',dir='/private/tmp') as temporary:
        folder = Path(temporary).resolve()
        source = folder / 'source.ppt'
        source.write_bytes(data)
        profile = folder / 'profile'
        (profile / 'user').mkdir(parents=True)
        (profile / 'user' / 'registrymodifications.xcu').write_text(PROFILE)
        command = [str(SANDBOX), '-p', sandbox_policy(folder), str(OFFICE),
                   '-env:UserInstallation=' + profile.as_uri(), '-env:OSL_SOCKET_PATH='+str(folder), '--headless',
                   '--nologo', '--nodefault', '--norestore', '--convert-to',
                   'pptx:Impress MS PowerPoint 2007 XML', '--outdir', str(folder), str(source)]
        # No shell; no user-supplied command, profile, output path or URL.
        environment={'HOME':str(folder),'TMPDIR':str(folder)+'/',
                     'PATH':'/usr/bin:/bin','LANG':'en_US.UTF-8',
                     'SAL_USE_VCLPLUGIN':'svp'}
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=False,
                                   cwd=folder,env=environment)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise ValueError('Legacy PowerPoint conversion timed out') from None
        output = folder / 'source.pptx'
        if code or not output.is_file() or output.is_symlink():
            raise ValueError('Legacy PowerPoint conversion produced no verified output')
        if not 1 <= output.stat().st_size <= MAX_INPUT:
            raise ValueError('Converted PowerPoint exceeds the reader limit')
        if source.read_bytes() != data:
            raise ValueError('Converter changed the input copy')
        converted = output.read_bytes()
        if not converted.startswith(b'PK\x03\x04'):
            raise ValueError('Converted output is not an Office archive')
        return converted


def extract(data):
    converted = convert(data)
    result = extract_office(converted)
    if result.get('format') != 'pptx' or not result.get('text', '').strip() or result.get('error'):
        raise ValueError('Converted PowerPoint has no verified slide text')
    return dict(result, format='ppt', original_format='ppt', conversion={
        'method': 'local_libreoffice_to_pptx', 'original_sha256': digest(data),
        'derived_sha256': digest(converted), 'external_network': 'denied',
        'macros': 'disabled_in_isolated_profile', 'original_preserved': True,
        'filesystem': 'conversion_directory_and_read_only_application_resources',
    }, limitations=result['limitations'] + [
        'Legacy conversion can change layout. Slide text and notes are readable; diagrams and visual fidelity require the original.',
        'This local recovery does not establish live Moodle freshness or release support on Windows.',
    ])


if __name__ == '__main__':
    try:
        result = extract(sys.stdin.buffer.read(MAX_INPUT + 1))
    except (ValueError, OSError, subprocess.SubprocessError):
        result = {'error': 'Legacy PowerPoint extraction unavailable; retain and open the original.'}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(1 if result.get('error') else 0)
