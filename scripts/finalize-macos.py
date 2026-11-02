#!/usr/bin/env python3
"""서명한 앱의 공증 업로드와 공증 완료 배포 파일을 만든다. 비밀값은 읽지 않는다."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess


def run(*args):
    result = subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True)
    return result.stdout + result.stderr


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def signature(app):
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
    details = run('/usr/bin/codesign', '--display', '--verbose=4', app)
    if ('Authority=Developer ID Application:' not in details or
            'TeamIdentifier=HCDUXX4Z3X' not in details or '(runtime)' not in details):
        raise ValueError('Developer ID, expected team and hardened runtime are required')
    return details


def bundle_digest(app):
    digest = hashlib.sha256()
    for path in sorted(app.rglob('*')):
        if path.is_symlink():
            value = f'link:{path.readlink()}'
        elif path.is_file():
            value = sha256(path)
        else:
            continue
        digest.update(f'{path.relative_to(app)}\0{value}\n'.encode())
    return digest.hexdigest()


def prepare(out):
    app = out / 'Callpath.app'
    info = json.loads((out / 'package-info.json').read_text())
    ci = json.loads((out / 'ci.json').read_text())
    if not info['signed'] or info['architectures'] != ['arm64', 'x86_64']:
        raise ValueError('A signed universal app is required')
    if ci['headSha'] != info['sourceSHA'] or ci['conclusion'] != 'success':
        raise ValueError('CI candidate mismatch')
    plist = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if plist['CFBundleIdentifier'] != info['bundleId'] or plist['CFBundleShortVersionString'] != info['version']:
        raise ValueError('Bundle identity or version mismatch')
    if sha256(app / 'Contents/MacOS/Callpath') != info['binarySHA256']:
        raise ValueError('Packaged executable changed')
    signature(app)
    upload = out / 'notarization-upload.zip'
    if upload.exists():
        raise ValueError('Notarization upload already exists')
    run('/usr/bin/ditto', '-c', '-k', '--keepParent', app, upload)
    write_json(out / 'notarization-state.json', {
        'uploadSHA256': sha256(upload), 'bundleSHA256': bundle_digest(app), **info,
    })
    print(upload)


def finalize(out, receipt_path):
    state = json.loads((out / 'notarization-state.json').read_text())
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('status') != 'Accepted' or not receipt.get('id'):
        raise ValueError('An Accepted notarization receipt is required')
    app = out / 'Callpath.app'
    if sha256(out / 'notarization-upload.zip') != state['uploadSHA256'] or bundle_digest(app) != state['bundleSHA256']:
        raise ValueError('Candidate changed after notarization upload')
    archive = out / f'Callpath-{state["version"]}-macos-universal.zip'
    if archive.exists() or (out / 'release-manifest.json').exists():
        raise ValueError('Final release files already exist')
    signature(app)
    run('xcrun', 'stapler', 'staple', app)
    run('xcrun', 'stapler', 'validate', app)
    signature(app)
    gatekeeper = run('/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=4', app)
    run('/usr/bin/ditto', '-c', '-k', '--keepParent', app, archive)
    checksum = sha256(archive)
    with (out / 'SHA256SUMS').open('x') as stream:
        stream.write(f'{checksum}  {archive.name}\n')
    write_json(out / 'release-manifest.json', {
        **state, 'archive': archive.name, 'sha256': checksum,
        'notarization': {'status': receipt['status'], 'submissionId': receipt['id']},
        'ci': json.loads((out / 'ci.json').read_text())['url'],
        'gatekeeper': gatekeeper.strip(),
    })
    print(f'{archive}\nSHA256 {checksum}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'finalize'])
    parser.add_argument('out', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    if args.phase == 'prepare':
        prepare(args.out.resolve())
    elif args.receipt:
        finalize(args.out.resolve(), args.receipt)
    else:
        parser.error('finalize requires --receipt')
