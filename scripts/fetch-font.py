"""Fetch the versioned, checksum-verified font when building or developing."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

target = Path(__file__).resolve().parent.parent / 'static/fonts/PretendardVariable-1.3.9.woff2'
expected = '9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4'
source = 'https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2'
data = target.read_bytes() if target.exists() else urlopen(source, timeout=30).read()
if hashlib.sha256(data).hexdigest() != expected or data[:4] != b'wOF2':
    raise RuntimeError('Pretendard font integrity check failed')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(data)
print('Pretendard 1.3.9 font verified.')
