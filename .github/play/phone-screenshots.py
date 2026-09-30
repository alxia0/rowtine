#!/usr/bin/env python3
"""Replace the Google Play phone screenshots with fastlane/metadata/android/<locale>/images/phoneScreenshots.

    python3 .github/play/phone-screenshots.py <service-account.json> [--dry-run]

Only the phone screenshots change: texts, icon and feature graphic stay as they are in the
Play Console. A locale whose screenshots already match (same files, same order, by sha256)
is left alone, and nothing is committed when no locale changed, so re-running it on every
release does not send the listing for review again.
"""
import hashlib, json, sys, time
from pathlib import Path

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

PACKAGE = 'com.rowtine.app'
API = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}'
UPLOAD = f'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}'
METADATA = Path(__file__).resolve().parents[2] / 'fastlane/metadata/android'


def b64(data):
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b'=')


def token(key):
    now = int(time.time())
    header = b64(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claims = b64(json.dumps({
        'iss': key['client_email'], 'scope': 'https://www.googleapis.com/auth/androidpublisher',
        'aud': key['token_uri'], 'iat': now, 'exp': now + 3600,
    }).encode())
    pem = serialization.load_pem_private_key(key['private_key'].encode(), password=None)
    signature = b64(pem.sign(header + b'.' + claims, padding.PKCS1v15(), hashes.SHA256()))
    r = requests.post(key['token_uri'], data={
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion': (header + b'.' + claims + b'.' + signature).decode(),
    })
    r.raise_for_status()
    return r.json()['access_token']


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dry_run = '--dry-run' in sys.argv
    key = json.loads(Path(sys.argv[1]).read_text())
    s = requests.Session()
    s.headers['Authorization'] = f'Bearer {token(key)}'

    def call(method, url, **kw):
        r = s.request(method, url, **kw)
        if not r.ok:
            sys.exit(f'{method} {url} -> {r.status_code}\n{r.text}')
        return r.json() if r.content else {}

    edit = call('POST', f'{API}/edits')['id']
    changed = []
    try:
        listings = [l['language'] for l in call('GET', f'{API}/edits/{edit}/listings').get('listings', [])]
        for lang in sorted(listings):
            folder = METADATA / lang / 'images/phoneScreenshots'
            files = sorted(folder.glob('*.png')) if folder.is_dir() else []
            if not files:
                print(f'{lang}: no local screenshots, skipped')
                continue
            local = [hashlib.sha256(f.read_bytes()).hexdigest() for f in files]
            remote = [i.get('sha256') for i in call('GET', f'{API}/edits/{edit}/listings/{lang}/phoneScreenshots').get('images', [])]
            if local == remote:
                print(f'{lang}: {len(files)} screenshots already up to date')
                continue
            print(f'{lang}: {len(remote)} on Play -> {len(files)} local')
            changed.append(lang)
            if dry_run:
                continue
            call('DELETE', f'{API}/edits/{edit}/listings/{lang}/phoneScreenshots')
            for f in files:
                call('POST', f'{UPLOAD}/edits/{edit}/listings/{lang}/phoneScreenshots',
                     params={'uploadType': 'media'}, data=f.read_bytes(), headers={'Content-Type': 'image/png'})
        if changed and not dry_run:
            call('POST', f'{API}/edits/{edit}:validate')
            call('POST', f'{API}/edits/{edit}:commit')
            print(f'committed: {", ".join(changed)}')
            return
    except BaseException:
        s.delete(f'{API}/edits/{edit}')
        raise
    s.delete(f'{API}/edits/{edit}')
    print('dry run, nothing committed' if dry_run else 'nothing to change')


if __name__ == '__main__':
    main()
