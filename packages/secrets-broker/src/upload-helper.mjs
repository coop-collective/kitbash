// Served as a standalone Python 3 helper. No packages, broker login or credential output required.
export const uploadHelper = String.raw`#!/usr/bin/env python3
import argparse
import json
import os
import re
import stat
import sys
import urllib.request
import urllib.error
from urllib.parse import urlsplit

LIMIT = 262144

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def private_read(filename, limit):
    if not os.path.isabs(filename):
        raise ValueError('Absolute path required')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(filename, flags)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or (hasattr(os, 'getuid') and info.st_uid != os.getuid()):
            raise ValueError('Private regular file required')
        content = handle.read(limit + 1)
        if len(content) > limit:
            raise ValueError('File too large')
        return content.decode('utf-8')

def send(url, body):
    request = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'User-Agent': 'kitbash-secrets-uploader/1.0'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=90) as response:
        raw = response.read(8193)
        if response.status != 200 or len(raw) > 8192:
            raise ValueError('Upload unconfirmed')
        return json.loads(raw)

def upload(ticket, assignments, post=send):
    if 'structuredContent' in ticket:
        ticket = ticket['structuredContent']
    url = urlsplit(ticket['uploadUrl'])
    parts = url.path.split('/')
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or len(parts) != 8 or parts[1:3] != ['v1', 'uploads']:
        raise ValueError('Invalid upload destination')
    if parts[4] != ticket['project'] or parts[5] != ticket['target'] or parts[6] != ticket['uploadId'] or not re.fullmatch(r'[A-Za-z0-9_-]{43}', parts[7]):
        raise ValueError('Upload scope mismatch')
    values = {}
    for assignment in assignments:
        name, filename = assignment.split('=', 1)
        if name in values or name not in ticket['names']:
            raise ValueError('Unexpected secret name')
        value = private_read(filename, 65536)
        if not value.strip() or '\0' in value:
            raise ValueError('Empty or invalid secret')
        values[name] = value
    if sorted(values) != sorted(ticket['names']) or not 1 <= len(values) <= 10:
        raise ValueError('Provide exactly the requested files')
    body = json.dumps({'secrets': values}, ensure_ascii=False).encode('utf-8')
    if len(body) > LIMIT:
        raise ValueError('Upload too large')
    result = post(ticket['uploadUrl'], body)
    if result.get('status') not in ['stored', 'pending'] or result.get('uploadId') != ticket['uploadId'] or result.get('project') != ticket['project'] or result.get('target') != ticket['target'] or sorted(result.get('names', [])) != sorted(ticket['names']):
        raise ValueError('Upload unconfirmed')
    return {key: result[key] for key in ['status', 'project', 'target', 'uploadId', 'names']}

def main():
    parser = argparse.ArgumentParser(description='Upload local private secret files using a Kitbash MCP upload ticket. Prints names/status only.')
    parser.add_argument('--ticket', required=True, help='Absolute private JSON file containing the MCP result, or - for stdin')
    parser.add_argument('--secret', action='append', required=True, help='NAME=/absolute/private/file; repeat for each name')
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(32769) if args.ticket == '-' else private_read(args.ticket, 32768)
        if len(raw.encode('utf-8')) > 32768:
            raise ValueError('Ticket too large')
        print(json.dumps(upload(json.loads(raw), args.secret)))
    except urllib.error.HTTPError as error:
        print(json.dumps({'status': 'upload-unconfirmed', 'httpStatus': error.code, 'next': 'Check kitbash_upload_secrets status before retrying.'}), file=sys.stderr)
        return 1
    except Exception:
        print('Upload unconfirmed. Check private file permissions and use kitbash_upload_secrets status before retrying. Values and provider responses were omitted.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
`;
